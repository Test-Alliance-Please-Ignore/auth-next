import { DurableObject } from 'cloudflare:workers'

import {
	and,
	asc,
	createDbClient,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNull,
	isNotNull,
	lt,
	lte,
	sql,
} from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { assertEveCharacterId, createEveCharacterId } from '@repo/eve-types'
import { buildEsiUserKey, EsiRateLimitGuard, EsiRateLimitStore } from '@repo/esi-rate-limit'
import {
	EsiGetCharacterFleetInformation,
	esiGetCharacterFleetInformationSchema,
	EsiGetFleetInformation,
	esiGetFleetInformationSchema,
	EsiGetFleetMembers,
	esiGetFleetMembersSchema,
	FleetDetailsResponse,
	FleetInformation,
	FleetJoinResult,
	Fleets,
	KickTrackingSessionMemberResult,
	QuickJoinCreationResult,
	QuickJoinInvitation,
	QuickJoinValidationResult,
	CharacterRecentSessionRow,
	CharacterStatsResult,
	CorpRollupRow,
	SessionCurrentMemberRow,
	SessionLiveSnapshot,
	SessionMemberShipHistoryRow,
	SessionRosterRow,
	SessionSummary,
	SessionTimelineResult,
	SessionTimelineRow,
	StartTrackingSessionError,
	StartTrackingSessionResult,
	StatsOverviewResult,
	StatsRange,
	TrackingSession,
	TrackingSessionListFilter,
	TrackingSessionListResult,
} from '@repo/fleets'
import { logger } from '@repo/hono-helpers'

import { Env } from './context'
import {
	fleetInvitations,
	fleetMemberHistory,
	fleetMemberships,
	fleetMemberShipEvents,
	fleetStateCache,
	fleetSummaries,
	fleetTrackingSessions,
	schema,
} from './db/schema'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { EveCharacterId } from '@repo/eve-types'
import type { FleetMonitor } from '@repo/fleets'
import type { Universe } from '@repo/universe'

/**
 * Fleets Durable Object
 *
 * This Durable Object uses SQLite storage and implements:
 * - RPC methods for remote calls
 * - WebSocket hibernation API
 * - Alarm handler for scheduled tasks
 * - SQLite storage via sql.exec()
 */
export class FleetsDO extends DurableObject implements Fleets {
	private db: ReturnType<typeof createDbClient<typeof schema>>
	private readonly esiRateLimits: EsiRateLimitGuard

	private formatFleetKickError(
		response: Pick<Response, 'status'>,
		details = ''
	): string {
		let parsedDetails = details
		if (parsedDetails) {
			try {
				const parsed = JSON.parse(parsedDetails) as { error?: string; message?: string }
				parsedDetails = parsed.error || parsed.message || parsedDetails
			} catch {
				// keep raw body text when it's not JSON
			}
		}

		switch (response.status) {
			case 401:
				return 'Unauthorized ESI token for fleet commander'
			case 403:
				return 'Fleet commander token lacks permission to remove this member'
			case 404:
				return 'Fleet or member not found (member may have already left)'
			case 422:
				return parsedDetails || 'ESI rejected the member removal request'
			default:
				return parsedDetails || `ESI returned ${response.status}`
		}
	}

	private isEsiRateLimitError(error: unknown): boolean {
		return error instanceof Error && error.message.includes('ESI rate limit active')
	}

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDbClient(this.env.DATABASE_URL, schema)
		this.esiRateLimits = new EsiRateLimitGuard(new EsiRateLimitStore(this.env.ESI_RATE_LIMITS))
	}

	/**
	 * Generate a URL-safe random token
	 */
	private generateToken(length: number = 24): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
		const randomBytes = new Uint8Array(length)
		crypto.getRandomValues(randomBytes)
		return Array.from(randomBytes)
			.map((byte) => chars[byte % chars.length])
			.join('')
	}

	async getCharacterFleetInformation(characterId: EveCharacterId): Promise<FleetInformation> {
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		logger.info('[Fleets DO] Getting fleet information for character', { characterId })

		try {
			// Fetch from ESI without schema (schemas can't be serialized across DO boundary)
			logger.debug('[Fleets DO] Making ESI request', {
				characterId,
				endpoint: `/characters/${characterId}/fleet/`,
			})

			const response = await tokenStore.fetchEsi<EsiGetCharacterFleetInformation>(
				`/characters/${characterId}/fleet/`,
				characterId
			)

			// Validate the response locally using the schema
			const validatedData = esiGetCharacterFleetInformationSchema.parse(response.data)

			logger.info('[Fleets DO] ESI response received', {
				characterId,
				fleetId: validatedData.fleet_id,
				fleetBossId: validatedData.fleet_boss_id,
				role: validatedData.role,
				squadId: validatedData.squad_id,
				wingId: validatedData.wing_id,
			})

			const fleetDetailsResponse = await this.getFleetDetails(
				String(validatedData.fleet_id),
				String(validatedData.fleet_boss_id)
			)
			// Ensure IDs are returned as strings for consistency
			return {
				fleet_id: String(validatedData.fleet_id),
				fleet_boss_id: String(validatedData.fleet_boss_id),
				role: validatedData.role,
				squad_id: validatedData.squad_id,
				wing_id: validatedData.wing_id,
				lastUpdated: new Date().toISOString(),
			} as FleetInformation
		} catch (error) {
			// Safely extract error information without serializing complex objects
			const errorMessage = error instanceof Error ? error.message : String(error)
			const errorName = error instanceof Error ? error.constructor.name : typeof error

			logger.error('[Fleets DO] Error fetching fleet information for character', {
				characterId,
				error: errorMessage,
				errorType: errorName,
			})

			// Check if it's a 404 error (character not in a fleet) - this is expected and should return default
			if (error instanceof Error) {
				const is404 =
					error.message.includes('404') ||
					error.message.includes('Not found') ||
					error.message.includes('Not Found') ||
					error.message.includes('ESI request failed: 404')

				if (is404) {
					logger.info('[Fleets DO] Character is not in a fleet (404 response)', {
						characterId,
					})
					// Return default if character is not in a fleet (this is expected)
					return {
						fleet_boss_id: '0',
						fleet_id: '0',
						role: 'fleet_commander',
						squad_id: 0,
						wing_id: 0,
						lastUpdated: new Date().toISOString(),
					} as FleetInformation
				}

				// For all other errors (401, 403, 500, network errors, etc.), throw the error
				// This allows the scheduled handler to know there was a problem and log it appropriately
				// The scheduled handler uses Promise.allSettled, so this won't stop other commanders from being checked
				logger.error('[Fleets DO] Unexpected error fetching fleet information', {
					characterId,
					error: errorMessage,
					errorType: errorName,
					note: 'This error will be propagated to the scheduled handler',
				})
			}

			// Re-throw the error so the scheduled handler knows there was a problem
			// This ensures failures are properly tracked and don't silently prevent monitoring
			throw error
		}
	}

	async createQuickJoinInvitation(
		fleetBossId: string,
		fleetId: string,
		expiresInHours: number = 24,
		maxUses?: number
	): Promise<QuickJoinCreationResult> {
		// Verify the fleet boss actually owns the fleet
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		// Check fleet info to verify boss
		let fleetData: EsiGetFleetInformation
		try {
			const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
				`/fleets/${fleetId}/`,
				fleetBossId
			)
			fleetData = esiGetFleetInformationSchema.parse(fleetResponse.data)
		} catch (error) {
			throw new Error('Unable to verify fleet ownership')
		}

		// Generate token
		const token = this.generateToken()
		const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)

		// Store in database
		const [invitation] = await this.db
			.insert(fleetInvitations)
			.values({
				token,
				fleetBossId,
				fleetId,
				expiresAt,
				maxUses: maxUses || null,
				usesCount: 0,
				isActive: true,
			})
			.returning()

		// Update fleet cache
		await this.db
			.insert(fleetStateCache)
			.values({
				fleetId,
				fleetBossId,
				isActive: true,
				memberCount: 0,
				motd: fleetData.motd || null,
				isFreeMove: fleetData.is_free_move,
				isRegistered: fleetData.is_registered,
				isVoiceEnabled: fleetData.is_voice_enabled,
			})
			.onConflictDoUpdate({
				target: fleetStateCache.fleetId,
				set: {
					fleetBossId,
					isActive: true,
					motd: fleetData.motd || null,
					isFreeMove: fleetData.is_free_move,
					isRegistered: fleetData.is_registered,
					isVoiceEnabled: fleetData.is_voice_enabled,
					lastChecked: new Date(),
					updatedAt: new Date(),
				},
			})

		return {
			token,
			url: `https://pleaseignore.app/fleets/join/${token}`,
			expiresAt,
		}
	}

	async validateQuickJoinToken(token: string): Promise<QuickJoinValidationResult> {
		// Fetch invitation from database
		const [invitation] = await this.db
			.select()
			.from(fleetInvitations)
			.where(
				and(
					eq(fleetInvitations.token, token),
					eq(fleetInvitations.isActive, true),
					gt(fleetInvitations.expiresAt, new Date())
				)
			)
			.limit(1)

		if (!invitation) {
			return {
				valid: false,
				error: 'Invalid or expired invitation token',
			}
		}

		// Check if max uses exceeded
		if (invitation.maxUses && invitation.usesCount >= invitation.maxUses) {
			return {
				valid: false,
				error: 'This invitation has reached its maximum uses',
			}
		}

		// Verify fleet is still active
		const isActive = await this.isFleetActive(invitation.fleetId, invitation.fleetBossId)

		if (!isActive) {
			// Mark invitation as inactive
			await this.db
				.update(fleetInvitations)
				.set({ isActive: false })
				.where(eq(fleetInvitations.id, invitation.id))

			return {
				valid: false,
				error: 'The fleet is no longer active',
			}
		}

		// Get fleet details
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		let fleetInfo: EsiGetFleetInformation | undefined
		try {
			const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
				`/fleets/${invitation.fleetId}/`,
				invitation.fleetBossId
			)
			fleetInfo = esiGetFleetInformationSchema.parse(fleetResponse.data)
		} catch (error) {
			// Fleet info fetch failed, but invitation is valid
			fleetInfo = undefined
		}

		// Get fleet boss name
		const characterStub = getStub<EveCharacterData>(
			this.env.EVE_CHARACTER_DATA,
			invitation.fleetBossId
		)
		const characterInfo = await characterStub.getCharacterInfo(invitation.fleetBossId)

		return {
			valid: true,
			invitation: {
				id: invitation.id,
				token: invitation.token,
				fleetBossId: invitation.fleetBossId,
				fleetId: invitation.fleetId,
				expiresAt: invitation.expiresAt,
				maxUses: invitation.maxUses || undefined,
				usesCount: invitation.usesCount,
				isActive: invitation.isActive,
			},
			fleetInfo,
			fleetBossName: characterInfo?.name,
		}
	}

	async getFleetDetails(fleetId: string, characterId: string): Promise<FleetDetailsResponse> {
		// Check if fleet is marked as not found in cache
		const [cached] = await this.db
			.select()
			.from(fleetStateCache)
			.where(eq(fleetStateCache.fleetId, fleetId))
			.limit(1)

		if (cached?.notFound && cached.notFoundAt) {
			const notFoundAge = Date.now() - cached.notFoundAt.getTime()
			const twentyFourHours = 24 * 60 * 60 * 1000
			if (notFoundAge < twentyFourHours) {
				console.log(
					`[Fleet ${fleetId}] Marked as 404, skipping ESI query (age: ${Math.round(notFoundAge / 1000 / 60)} minutes)`
				)
				throw new Error('Fleet not found (404)')
			}
		}

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		// Fetch fleet info
		let fleetInfo: EsiGetFleetInformation
		try {
			const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
				`/fleets/${fleetId}/`,
				characterId
			)
			fleetInfo = esiGetFleetInformationSchema.parse(fleetResponse.data)

			// Update cache with all fleet properties
			await this.db
				.insert(fleetStateCache)
				.values({
					fleetId,
					fleetBossId: characterId,
					isActive: true,
					memberCount: 0,
					motd: fleetInfo.motd || null,
					isFreeMove: fleetInfo.is_free_move,
					isRegistered: fleetInfo.is_registered,
					isVoiceEnabled: fleetInfo.is_voice_enabled,
					notFound: false,
					notFoundAt: null,
					lastChecked: new Date(),
				})
				.onConflictDoUpdate({
					target: fleetStateCache.fleetId,
					set: {
						fleetBossId: characterId,
						isActive: true,
						motd: fleetInfo.motd || null,
						isFreeMove: fleetInfo.is_free_move,
						isRegistered: fleetInfo.is_registered,
						isVoiceEnabled: fleetInfo.is_voice_enabled,
						notFound: false,
						notFoundAt: null,
						lastChecked: new Date(),
						updatedAt: new Date(),
					},
				})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			// Check if it's a 404 error
			if (
				errorMessage.includes('404') ||
				errorMessage.includes('Not found') ||
				errorMessage.includes('Not Found')
			) {
				console.log(`[Fleet ${fleetId}] Received 404 from ESI, marking as not found`)

				// Mark fleet as not found
				await this.db
					.insert(fleetStateCache)
					.values({
						fleetId,
						fleetBossId: characterId,
						isActive: false,
						memberCount: 0,
						notFound: true,
						notFoundAt: new Date(),
						lastChecked: new Date(),
					})
					.onConflictDoUpdate({
						target: fleetStateCache.fleetId,
						set: {
							notFound: true,
							notFoundAt: new Date(),
							isActive: false,
							lastChecked: new Date(),
							updatedAt: new Date(),
						},
					})
			}
			throw error
		}

		// Fetch fleet members
		let members: EsiGetFleetMembers | undefined
		let memberCount = 0
		try {
			const membersResponse = await tokenStore.fetchEsi<EsiGetFleetMembers>(
				`/fleets/${fleetId}/members/`,
				characterId
			)

			// Debug logging to see raw ESI response
			console.log(
				'[Fleet Members] Raw ESI response sample (first member):',
				JSON.stringify(membersResponse.data[0], null, 2)
			)
			console.log(
				'[Fleet Members] First member station_id type:',
				typeof membersResponse.data[0]?.station_id
			)
			console.log(
				'[Fleet Members] First member station_id value:',
				membersResponse.data[0]?.station_id
			)

			members = esiGetFleetMembersSchema.parse(membersResponse.data)
			memberCount = members.length
		} catch (error) {
			// Members fetch failed, but continue
			console.error('[Fleet Members] Failed to parse or fetch:', error)
			members = undefined
		}

		// Get fleet boss name
		const characterStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, characterId)
		const characterInfo = await characterStub.getCharacterInfo(characterId)

		// Resolve ship type IDs, character IDs, system IDs, and station IDs to names if members are available
		let resolvedShipTypes: Record<string, string> | undefined
		let resolvedCharacterNames: Record<string, string> | undefined
		let resolvedSystemNames: Record<string, string> | undefined
		let resolvedStationNames: Record<string, string> | undefined
		if (members && members.length > 0) {
			try {
				// Resolve ship type IDs
				const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
				const uniqueShipTypeIds = [...new Set(members.map((m) => String(m.ship_type_id)))]
				const shipTypes = await universeStub.resolveTypeNamesByIds(uniqueShipTypeIds)
				resolvedShipTypes = Object.fromEntries(
					Object.entries(shipTypes).map(([id, type]) => [id, type?.typeName || id])
				)
			} catch (error) {
				logger.warn(`[Fleets DO] Failed to resolve ship type names`, {
					fleetId,
					error: error instanceof Error ? error.message : String(error),
				})
			}

			try {
				// Resolve character IDs to names
				const uniqueCharacterIds = [...new Set(members.map((m) => String(m.character_id)))]
				// Also include fleet boss if not already in the list
				if (characterId && !uniqueCharacterIds.includes(characterId)) {
					uniqueCharacterIds.push(characterId)
				}
				const characterNames = await tokenStore.resolveIds(uniqueCharacterIds)
				resolvedCharacterNames = characterNames
			} catch (error) {
				logger.warn(`[Fleets DO] Failed to resolve character names`, {
					fleetId,
					error: error instanceof Error ? error.message : String(error),
				})
			}

			try {
				// Resolve system IDs to names
				const uniqueSystemIds = [...new Set(members.map((m) => String(m.solar_system_id)))]
				const systemNames = await tokenStore.resolveIds(uniqueSystemIds)
				resolvedSystemNames = systemNames
			} catch (error) {
				logger.warn(`[Fleets DO] Failed to resolve system names`, {
					fleetId,
					error: error instanceof Error ? error.message : String(error),
				})
			}

			try {
				// Resolve station IDs to names
				// Filter out null/undefined station IDs
				const stationIds = members
					.map((m) => m.station_id)
					.filter((id): id is number => id !== null && id !== undefined && id !== 0)
				const uniqueStationIds = [...new Set(stationIds.map((id) => String(id)))]

				if (uniqueStationIds.length > 0) {
					const stationNames = await tokenStore.resolveIds(uniqueStationIds)
					resolvedStationNames = stationNames
				}
			} catch (error) {
				logger.warn(`[Fleets DO] Failed to resolve station names`, {
					fleetId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		return {
			fleetInfo,
			members,
			fleetBossName: characterInfo?.name,
			memberCount,
			// Include resolved ship type names, character names, system names, and station names as metadata
			...(resolvedShipTypes && { shipTypeNames: resolvedShipTypes }),
			...(resolvedCharacterNames && { characterNames: resolvedCharacterNames }),
			...(resolvedSystemNames && { systemNames: resolvedSystemNames }),
			...(resolvedStationNames && { stationNames: resolvedStationNames }),
		}
	}

	async joinFleetViaQuickJoin(
		token: string,
		characterId: string,
		joiningCharacterId: string
	): Promise<FleetJoinResult> {
		// Validate token
		const validation = await this.validateQuickJoinToken(token)

		if (!validation.valid || !validation.invitation) {
			return {
				success: false,
				error: validation.error || 'Invalid token',
			}
		}

		const { invitation } = validation

		// Check if character is already in the fleet
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		try {
			const membersResponse = await tokenStore.fetchEsi<EsiGetFleetMembers>(
				`/fleets/${invitation.fleetId}/members/`,
				invitation.fleetBossId
			)

			// Debug logging to see raw ESI response
			console.log(
				'[Fleet Join] Raw ESI response sample (first member):',
				JSON.stringify(membersResponse.data[0], null, 2)
			)
			console.log(
				'[Fleet Join] First member station_id type:',
				typeof membersResponse.data[0]?.station_id
			)
			console.log(
				'[Fleet Join] First member station_id value:',
				membersResponse.data[0]?.station_id
			)

			const members = esiGetFleetMembersSchema.parse(membersResponse.data)

			const isAlreadyMember = members.some(
				(member: any) => member.character_id.toString() === joiningCharacterId
			)

			if (isAlreadyMember) {
				return {
					success: false,
					error: 'Character is already in the fleet',
				}
			}
		} catch (error) {
			// Continue even if member check fails
			console.error('Failed to check fleet members:', error)
		}

		// Create fleet invitation using FC's credentials
		// Note: ESI fleet invitation endpoint needs custom fetch since it's a POST
		try {
			// We need to make a direct ESI call for POST operations
			const accessToken = await tokenStore.getAccessToken(invitation.fleetBossId)
			if (!accessToken) {
				return {
					success: false,
					error: 'Fleet commander ESI access expired',
				}
			}

			await this.esiRateLimits.request({
				path: `/latest/fleets/${invitation.fleetId}/members/?datasource=tranquility`,
				userKey: buildEsiUserKey(this.env.EVE_SSO_CLIENT_ID, invitation.fleetBossId),
				method: 'POST',
				accessToken,
				jsonBody: {
					character_id: parseInt(joiningCharacterId),
					role: 'squad_member',
				},
				parse: async () => undefined,
				buildError: ({ response, body, path }) =>
					new Error(
						`ESI request failed: ${response.status} ${response.statusText || 'Request Failed'} - ${body || 'Unknown ESI error'} | path=${path}`
					),
			})
		} catch (error) {
			if (this.isEsiRateLimitError(error)) {
				return {
					success: false,
					error: 'ESI is temporarily rate limited. Please retry shortly.',
				}
			}
			console.error('Failed to create fleet invitation:', error)
			return {
				success: false,
				error: 'Failed to create fleet invitation',
			}
		}

		// Update usage count
		await this.db
			.update(fleetInvitations)
			.set({ usesCount: invitation.usesCount + 1 })
			.where(eq(fleetInvitations.id, invitation.id))

		// Record membership
		await this.db.insert(fleetMemberships).values({
			characterId: joiningCharacterId,
			fleetId: invitation.fleetId,
			invitationId: invitation.id,
			role: 'squad_member',
		})

		return {
			success: true,
			invitationSent: true,
		}
	}

	async isFleetActive(fleetId: string, characterId: string): Promise<boolean> {
		// Check cache first
		const [cached] = await this.db
			.select()
			.from(fleetStateCache)
			.where(
				and(
					eq(fleetStateCache.fleetId, fleetId),
					// Cache valid for 4 minutes 30 seconds (to eliminate race conditions)
					gt(fleetStateCache.lastChecked, new Date(Date.now() - (4 * 60 + 30) * 1000))
				)
			)
			.limit(1)

		if (cached) {
			// If fleet was marked as not found within last 24 hours, don't query ESI again
			if (cached.notFound && cached.notFoundAt) {
				const notFoundAge = Date.now() - cached.notFoundAt.getTime()
				const twentyFourHours = 24 * 60 * 60 * 1000
				if (notFoundAge < twentyFourHours) {
					console.log(
						`[Fleet ${fleetId}] Marked as 404, skipping ESI query (age: ${Math.round(notFoundAge / 1000 / 60)} minutes)`
					)
					return false
				}
			}
			return cached.isActive
		}

		// Check with ESI
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		let isActive = false
		let isNotFound = false
		let fleetInfo: EsiGetFleetInformation | null = null
		try {
			const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
				`/fleets/${fleetId}/`,
				characterId
			)
			// Validate the response to ensure it's valid fleet data
			fleetInfo = esiGetFleetInformationSchema.parse(fleetResponse.data)
			isActive = true
		} catch (error) {
			// Check if it's a 404 error
			const errorMessage = error instanceof Error ? error.message : String(error)
			if (
				errorMessage.includes('404') ||
				errorMessage.includes('Not found') ||
				errorMessage.includes('Not Found')
			) {
				console.log(`[Fleet ${fleetId}] Received 404 from ESI, marking as not found`)
				isNotFound = true
			}
			isActive = false
		}

		// Update cache with all fleet properties
		if (fleetInfo) {
			await this.db
				.insert(fleetStateCache)
				.values({
					fleetId,
					fleetBossId: characterId,
					isActive: true,
					memberCount: 0,
					motd: fleetInfo.motd || null,
					isFreeMove: fleetInfo.is_free_move,
					isRegistered: fleetInfo.is_registered,
					isVoiceEnabled: fleetInfo.is_voice_enabled,
					notFound: false,
					notFoundAt: null,
					lastChecked: new Date(),
				})
				.onConflictDoUpdate({
					target: fleetStateCache.fleetId,
					set: {
						fleetBossId: characterId,
						isActive: true,
						motd: fleetInfo.motd || null,
						isFreeMove: fleetInfo.is_free_move,
						isRegistered: fleetInfo.is_registered,
						isVoiceEnabled: fleetInfo.is_voice_enabled,
						notFound: false,
						notFoundAt: null,
						lastChecked: new Date(),
						updatedAt: new Date(),
					},
				})
		} else {
			// Fleet not found or error - update cache with not found status
			await this.db
				.insert(fleetStateCache)
				.values({
					fleetId,
					fleetBossId: characterId,
					isActive: false,
					memberCount: 0,
					notFound: isNotFound,
					notFoundAt: isNotFound ? new Date() : null,
					lastChecked: new Date(),
				})
				.onConflictDoUpdate({
					target: fleetStateCache.fleetId,
					set: {
						isActive: false,
						notFound: isNotFound,
						notFoundAt: isNotFound ? new Date() : null,
						lastChecked: new Date(),
						updatedAt: new Date(),
					},
				})
		}

		return isActive
	}

	async getFleetCacheStatus(
		fleetId: string
	): Promise<{ isActive: boolean; notFound: boolean; endedAt: Date | null } | null> {
		const [cached] = await this.db
			.select({
				isActive: fleetStateCache.isActive,
				notFound: fleetStateCache.notFound,
				endedAt: fleetStateCache.endedAt,
			})
			.from(fleetStateCache)
			.where(eq(fleetStateCache.fleetId, fleetId))
			.limit(1)

		if (!cached) {
			return null
		}

		return {
			isActive: cached.isActive,
			notFound: cached.notFound,
			endedAt: cached.endedAt,
		}
	}

	async getFleetIsRegistered(fleetId: string, characterId: string): Promise<boolean> {
		// Check cache first with 4 minutes 30 seconds validity (same as isFleetActive)
		const [cached] = await this.db
			.select({
				isRegistered: fleetStateCache.isRegistered,
				lastChecked: fleetStateCache.lastChecked,
			})
			.from(fleetStateCache)
			.where(
				and(
					eq(fleetStateCache.fleetId, fleetId),
					// Cache valid for 4 minutes 30 seconds (to eliminate race conditions)
					gt(fleetStateCache.lastChecked, new Date(Date.now() - (4 * 60 + 30) * 1000))
				)
			)
			.limit(1)

		if (cached) {
			// Use cached value if fresh
			return cached.isRegistered
		}

		// Cache is missing or stale, fetch from ESI
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		let fleetInfo: EsiGetFleetInformation | null = null
		let isNotFound = false

		try {
			const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
				`/fleets/${fleetId}/`,
				characterId
			)
			fleetInfo = esiGetFleetInformationSchema.parse(fleetResponse.data)
		} catch (error) {
			// Check if it's a 404 error
			const errorMessage = error instanceof Error ? error.message : String(error)
			if (
				errorMessage.includes('404') ||
				errorMessage.includes('Not found') ||
				errorMessage.includes('Not Found')
			) {
				isNotFound = true
			}
			// If fleet not found, return false for isRegistered
			fleetInfo = null
		}

		// Update cache with all fleet properties
		if (fleetInfo) {
			await this.db
				.insert(fleetStateCache)
				.values({
					fleetId,
					fleetBossId: characterId,
					isActive: true,
					memberCount: 0,
					motd: fleetInfo.motd || null,
					isFreeMove: fleetInfo.is_free_move,
					isRegistered: fleetInfo.is_registered,
					isVoiceEnabled: fleetInfo.is_voice_enabled,
					notFound: false,
					notFoundAt: null,
					lastChecked: new Date(),
				})
				.onConflictDoUpdate({
					target: fleetStateCache.fleetId,
					set: {
						fleetBossId: characterId,
						isActive: true,
						motd: fleetInfo.motd || null,
						isFreeMove: fleetInfo.is_free_move,
						isRegistered: fleetInfo.is_registered,
						isVoiceEnabled: fleetInfo.is_voice_enabled,
						notFound: false,
						notFoundAt: null,
						lastChecked: new Date(),
						updatedAt: new Date(),
					},
				})

			return fleetInfo.is_registered
		}

		// Fleet not found or error - update cache with not found status
		await this.db
			.insert(fleetStateCache)
			.values({
				fleetId,
				fleetBossId: characterId,
				isActive: false,
				memberCount: 0,
				notFound: isNotFound,
				notFoundAt: isNotFound ? new Date() : null,
				lastChecked: new Date(),
			})
			.onConflictDoUpdate({
				target: fleetStateCache.fleetId,
				set: {
					isActive: false,
					notFound: isNotFound,
					notFoundAt: isNotFound ? new Date() : null,
					lastChecked: new Date(),
					updatedAt: new Date(),
				},
			})

		return false
	}

	async revokeQuickJoinInvitation(token: string, characterId: string): Promise<boolean> {
		// Verify ownership
		const [invitation] = await this.db
			.select()
			.from(fleetInvitations)
			.where(and(eq(fleetInvitations.token, token), eq(fleetInvitations.fleetBossId, characterId)))
			.limit(1)

		if (!invitation) {
			return false
		}

		// Mark as inactive
		await this.db
			.update(fleetInvitations)
			.set({ isActive: false })
			.where(eq(fleetInvitations.id, invitation.id))

		return true
	}

	// ===== Manual fleet tracking sessions =====

	/**
	 * Start a new fleet tracking session.
	 *
	 * Flow:
	 *   1. Pre-flight ESI: confirm the character is currently the fleet boss.
	 *   2. Reject if the character already has an active session, or the fleet
	 *      itself is already tracked under another session.
	 *   3. Insert the session row with status='active' and the resolved fleetId.
	 *   4. Spawn the per-fleet FleetMonitor DO and initialize it.
	 *
	 * Errors are thrown as StartTrackingSessionError with a code the route can
	 * map to an HTTP status.
	 */
	async startTrackingSession(args: {
		characterId: string
		startedByUserId: string
		name: string
	}): Promise<StartTrackingSessionResult> {
		const { characterId, startedByUserId, name } = args

		// 1. Pre-flight ESI
		let fleetInfo: FleetInformation
		try {
			fleetInfo = await this.getCharacterFleetInformation(
				createEveCharacterId(characterId)
			)
		} catch (error) {
			logger.error('[FleetsDO startTrackingSession] ESI pre-flight failed', {
				characterId,
				error: error instanceof Error ? error.message : String(error),
			})
			throw new StartTrackingSessionError('esi_unavailable')
		}

		if (!fleetInfo.fleet_id || fleetInfo.fleet_id === '0') {
			throw new StartTrackingSessionError('not_in_fleet')
		}
		if (fleetInfo.fleet_boss_id !== characterId) {
			throw new StartTrackingSessionError('not_fleet_boss')
		}

		const fleetId = fleetInfo.fleet_id

		// 2. Reject duplicates (character + fleet)
		const existingByCharacter = await this.db
			.select({ id: fleetTrackingSessions.id })
			.from(fleetTrackingSessions)
			.where(
				and(
					eq(fleetTrackingSessions.characterId, characterId),
					eq(fleetTrackingSessions.status, 'active')
				)
			)
			.limit(1)
		if (existingByCharacter.length > 0) {
			throw new StartTrackingSessionError('character_session_active')
		}

		const existingByFleet = await this.db
			.select({ id: fleetTrackingSessions.id })
			.from(fleetTrackingSessions)
			.where(
				and(
					eq(fleetTrackingSessions.fleetId, fleetId),
					eq(fleetTrackingSessions.status, 'active')
				)
			)
			.limit(1)
		if (existingByFleet.length > 0) {
			throw new StartTrackingSessionError('fleet_session_active')
		}

		// 3. Insert the session row
		const [inserted] = await this.db
			.insert(fleetTrackingSessions)
			.values({
				name,
				characterId,
				startedByUserId,
				fleetId,
				status: 'active',
			})
			.returning({ id: fleetTrackingSessions.id })

		if (!inserted) {
			throw new Error('Failed to insert tracking session row')
		}
		const sessionId = inserted.id

		// 4. Spawn the FleetMonitor DO and initialize it
		try {
			const fleetMonitorStub = getStub<FleetMonitor>(
				this.env.FLEET_MONITOR,
				`fleet-${fleetId}`
			)
			await fleetMonitorStub.initializeMonitoring(fleetId, characterId, sessionId)
		} catch (error) {
			logger.error('[FleetsDO startTrackingSession] Failed to initialize FleetMonitor', {
				characterId,
				fleetId,
				sessionId,
				error: error instanceof Error ? error.message : String(error),
			})
			// Mark the session ended so it doesn't sit as a phantom active row
			await this.db
				.update(fleetTrackingSessions)
				.set({
					status: 'ended',
					endedAt: new Date(),
					endedReason: 'esi_error',
					updatedAt: new Date(),
				})
				.where(eq(fleetTrackingSessions.id, sessionId))
			throw new StartTrackingSessionError('esi_unavailable')
		}

		logger.info('[FleetsDO startTrackingSession] Session started', {
			sessionId,
			characterId,
			startedByUserId,
			fleetId,
		})

		return { sessionId }
	}

	/**
	 * Stop an active tracking session.
	 * Delegates the archive flow to the FleetMonitor DO via endSession().
	 */
	async stopTrackingSession(args: {
		sessionId: string
		endedReason: 'user_stopped' | 'admin_stopped'
		endedByUserId: string
	}): Promise<void> {
		const { sessionId, endedReason, endedByUserId } = args

		const [session] = await this.db
			.select()
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, sessionId))
			.limit(1)

		if (!session) {
			throw new Error(`Session not found: ${sessionId}`)
		}
		if (session.status !== 'active') {
			throw new Error(`Session is not active: ${sessionId}`)
		}
		if (!session.fleetId) {
			// Defensive — shouldn't happen because startTrackingSession only
			// inserts active rows with a resolved fleetId.
			throw new Error(`Active session has no fleetId: ${sessionId}`)
		}

		const fleetMonitorStub = getStub<FleetMonitor>(
			this.env.FLEET_MONITOR,
			`fleet-${session.fleetId}`
		)
		await fleetMonitorStub.endSession({
			sessionId,
			endedReason,
			endedByUserId,
		})
	}

	/**
	 * List tracking sessions, filterable.
	 */
	async listTrackingSessions(filter: TrackingSessionListFilter): Promise<TrackingSessionListResult> {
		const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
		const offset = Math.max(filter.offset ?? 0, 0)

		const conditions = []
		if (filter.characterId) {
			conditions.push(eq(fleetTrackingSessions.characterId, filter.characterId))
		}
		if (filter.startedByUserId) {
			conditions.push(eq(fleetTrackingSessions.startedByUserId, filter.startedByUserId))
		}
		if (filter.status) {
			conditions.push(eq(fleetTrackingSessions.status, filter.status))
		}
		if (filter.from) {
			conditions.push(gte(fleetTrackingSessions.startedAt, new Date(filter.from)))
		}
		if (filter.to) {
			conditions.push(lt(fleetTrackingSessions.startedAt, new Date(filter.to)))
		}
		const where = conditions.length > 0 ? and(...conditions) : undefined

		const items = await this.db
			.select()
			.from(fleetTrackingSessions)
			.where(where)
			.orderBy(desc(fleetTrackingSessions.startedAt))
			.limit(limit)
			.offset(offset)

		const totalResult = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(fleetTrackingSessions)
			.where(where)
		const total = totalResult[0]?.count ?? 0

		return {
			items: items.map(this.serializeSession),
			total,
			limit,
			offset,
		}
	}

	/**
	 * Get a single tracking session by id.
	 */
	async getTrackingSession(sessionId: string): Promise<TrackingSession | null> {
		const [row] = await this.db
			.select()
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, sessionId))
			.limit(1)
		return row ? this.serializeSession(row) : null
	}

	/**
	 * Get the live snapshot (last cache row) for an active session's fleet.
	 * Returns null if the session has not started ticking yet.
	 */
	async getSessionLiveSnapshot(sessionId: string): Promise<SessionLiveSnapshot | null> {
		const [session] = await this.db
			.select({ fleetId: fleetTrackingSessions.fleetId })
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, sessionId))
			.limit(1)
		if (!session || !session.fleetId) return null

		const [cache] = await this.db
			.select()
			.from(fleetStateCache)
			.where(eq(fleetStateCache.fleetId, session.fleetId))
			.limit(1)
		if (!cache) return null

		// Pull peak member count from the FleetMonitor DO's SQLite state.
		let peakMemberCount = cache.memberCount
		try {
			const monitorStub = getStub<FleetMonitor>(
				this.env.FLEET_MONITOR,
				`fleet-${session.fleetId}`
			)
			const state = await monitorStub.getMonitorState()
			if (state && typeof state.peakMemberCount === 'number') {
				peakMemberCount = Math.max(state.peakMemberCount, cache.memberCount)
			}
		} catch (error) {
			logger.warn('[FleetsDO] Could not read FleetMonitor state for peak', {
				fleetId: session.fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
		}

		return {
			fleetId: cache.fleetId,
			memberCount: cache.memberCount,
			peakMemberCount,
			motd: cache.motd,
			isFreeMove: cache.isFreeMove,
			isRegistered: cache.isRegistered,
			isVoiceEnabled: cache.isVoiceEnabled,
			lastChecked: cache.lastChecked.toISOString(),
			updatedAt: cache.updatedAt.toISOString(),
		}
	}

	/**
	 * Get the join/leave event log for a session, paginated.
	 * The session ↔ fleet relationship is resolved internally so callers only
	 * need the sessionId.
	 */
	async getSessionTimeline(args: {
		sessionId: string
		eventType?: 'join' | 'leave' | 'ship_change'
		characterId?: string
		limit?: number
		offset?: number
	}): Promise<SessionTimelineResult> {
		const limit = Math.min(Math.max(args.limit ?? 100, 1), 500)
		const offset = Math.max(args.offset ?? 0, 0)

		const [session] = await this.db
			.select({
				fleetId: fleetTrackingSessions.fleetId,
				startedAt: fleetTrackingSessions.startedAt,
				endedAt: fleetTrackingSessions.endedAt,
			})
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, args.sessionId))
			.limit(1)
		if (!session || !session.fleetId) {
			return { items: [], total: 0, limit, offset }
		}

		// --- 1) Join/leave rows from fleet_member_history ---
		const histConditions = [eq(fleetMemberHistory.fleetId, session.fleetId)]
		histConditions.push(gt(fleetMemberHistory.eventTimestamp, session.startedAt))
		if (session.endedAt) {
			histConditions.push(lte(fleetMemberHistory.eventTimestamp, session.endedAt))
		}
		if (args.characterId) {
			histConditions.push(eq(fleetMemberHistory.characterId, args.characterId))
		}
		const wantHistEvents = !args.eventType || args.eventType === 'join' || args.eventType === 'leave'
		if (args.eventType === 'join' || args.eventType === 'leave') {
			histConditions.push(eq(fleetMemberHistory.eventType, args.eventType))
		}

		const historyRows = wantHistEvents
			? await this.db
					.select()
					.from(fleetMemberHistory)
					.where(and(...histConditions))
			: []

		// --- 2) Ship-change rows from fleet_member_ship_events ---
		// A ship-change is any ship-event row whose startedAt is strictly
		// after the session's startedAt (i.e. not the initial seed row).
		// We then resolve the previous shipTypeId by walking the per-character
		// list in startedAt order.
		const wantShipChanges = !args.eventType || args.eventType === 'ship_change'
		const shipConditions = [eq(fleetMemberShipEvents.trackingSessionId, args.sessionId)]
		if (args.characterId) {
			shipConditions.push(eq(fleetMemberShipEvents.characterId, args.characterId))
		}
		const shipRows = wantShipChanges
			? await this.db
					.select()
					.from(fleetMemberShipEvents)
					.where(and(...shipConditions))
					.orderBy(asc(fleetMemberShipEvents.startedAt))
			: []

		// Build per-character ordered list so we can find previous shipTypeId
		const perCharacter = new Map<string, typeof shipRows>()
		for (const row of shipRows) {
			const list = perCharacter.get(row.characterId) ?? []
			list.push(row)
			perCharacter.set(row.characterId, list)
		}

		const shipChangeItems: SessionTimelineRow[] = []
		// A row is a ship change only if there's an earlier ship-event row for
		// the same character in the same session, AND the previous row had a
		// different shipTypeId. The first row per character is always the
		// initial board (either seeded or written on first appearance), never
		// a "change".
		for (const [, list] of perCharacter) {
			for (let i = 1; i < list.length; i++) {
				const row = list[i]
				const prev = list[i - 1]
				if (prev.shipTypeId === row.shipTypeId) continue
				shipChangeItems.push({
					id: `ship-${row.id}`,
					characterId: row.characterId,
					eventType: 'ship_change',
					shipTypeId: row.shipTypeId,
					shipTypeName: null, // resolved at route layer
					previousShipTypeId: prev.shipTypeId,
					previousShipTypeName: null,
					solarSystemId: row.solarSystemId,
					systemName: null,
					stationId: row.stationId,
					role: '',
					roleName: '',
					characterName: null,
					eventTimestamp: row.startedAt.toISOString(),
				})
			}
		}

		// --- 3) Merge + sort + paginate in memory ---
		const historyItems: SessionTimelineRow[] = historyRows.map((row) => ({
			id: row.id,
			characterId: row.characterId,
			eventType: row.eventType as 'join' | 'leave',
			shipTypeId: row.shipTypeId,
			shipTypeName: row.shipTypeName,
			solarSystemId: row.solarSystemId,
			systemName: row.systemName,
			stationId: row.stationId,
			role: row.role,
			roleName: row.roleName,
			characterName: row.characterName,
			eventTimestamp: row.eventTimestamp.toISOString(),
		}))
		const merged = [...historyItems, ...shipChangeItems].sort((a, b) =>
			b.eventTimestamp.localeCompare(a.eventTimestamp)
		)
		const total = merged.length
		const items = merged.slice(offset, offset + limit)

		return { items, total, limit, offset }
	}

	/**
	 * Get one character's ship-segment history within a session, ordered by time.
	 */
	async getSessionMemberShipHistory(args: {
		sessionId: string
		characterId: string
	}): Promise<SessionMemberShipHistoryRow[]> {
		const rows = await this.db
			.select()
			.from(fleetMemberShipEvents)
			.where(
				and(
					eq(fleetMemberShipEvents.trackingSessionId, args.sessionId),
					eq(fleetMemberShipEvents.characterId, args.characterId)
				)
			)
			.orderBy(asc(fleetMemberShipEvents.startedAt))

		return rows.map((row) => ({
			shipTypeId: row.shipTypeId,
			solarSystemId: row.solarSystemId,
			stationId: row.stationId,
			startedAt: row.startedAt.toISOString(),
			endedAt: row.endedAt ? row.endedAt.toISOString() : null,
		}))
	}

	/**
	 * Get the archived summary for a session, present only after the session has ended.
	 */
	async getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
		const [row] = await this.db
			.select()
			.from(fleetSummaries)
			.where(eq(fleetSummaries.trackingSessionId, sessionId))
			.limit(1)
		if (!row) return null
		return {
			startedAt: row.startedAt.toISOString(),
			endedAt: row.endedAt.toISOString(),
			durationMinutes: row.durationMinutes,
			peakMemberCount: row.peakMemberCount,
			finalMemberCount: row.finalMemberCount,
			motd: row.motd,
		}
	}

	/**
	 * Get the current member roster for an active session.
	 *
	 * Sources of truth: open ship-event rows (endedAt IS NULL) for this session.
	 * Each row represents a pilot currently in the fleet, with the ship/location
	 * they were last observed in.
	 */
	async getSessionCurrentMembers(sessionId: string): Promise<SessionCurrentMemberRow[]> {
		const rows = await this.db
			.select({
				characterId: fleetMemberShipEvents.characterId,
				shipTypeId: fleetMemberShipEvents.shipTypeId,
				solarSystemId: fleetMemberShipEvents.solarSystemId,
				stationId: fleetMemberShipEvents.stationId,
				startedAt: fleetMemberShipEvents.startedAt,
			})
			.from(fleetMemberShipEvents)
			.where(
				and(
					eq(fleetMemberShipEvents.trackingSessionId, sessionId),
					isNull(fleetMemberShipEvents.endedAt)
				)
			)
			.orderBy(asc(fleetMemberShipEvents.startedAt))

		return rows.map((row) => ({
			characterId: row.characterId,
			shipTypeId: row.shipTypeId,
			solarSystemId: row.solarSystemId,
			stationId: row.stationId,
			sinceTime: row.startedAt.toISOString(),
		}))
	}

	/**
	 * Get the full roster for any session (active or ended).
	 * Aggregates per-character timing and ship counts from fleet_member_ship_events.
	 */
	async getSessionRoster(sessionId: string): Promise<SessionRosterRow[]> {
		const [session] = await this.db
			.select({
				endedAt: fleetTrackingSessions.endedAt,
				status: fleetTrackingSessions.status,
			})
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, sessionId))
			.limit(1)
		if (!session) return []

		const rows = await this.db
			.select({
				characterId: fleetMemberShipEvents.characterId,
				shipTypeId: fleetMemberShipEvents.shipTypeId,
				startedAt: fleetMemberShipEvents.startedAt,
				endedAt: fleetMemberShipEvents.endedAt,
			})
			.from(fleetMemberShipEvents)
			.where(eq(fleetMemberShipEvents.trackingSessionId, sessionId))
			.orderBy(asc(fleetMemberShipEvents.characterId), asc(fleetMemberShipEvents.startedAt))

		if (rows.length === 0) return []

		// Group by character
		const grouped = new Map<
			string,
			Array<{ shipTypeId: number; startedAt: Date; endedAt: Date | null }>
		>()
		for (const row of rows) {
			const list = grouped.get(row.characterId) ?? []
			list.push({
				shipTypeId: row.shipTypeId,
				startedAt: row.startedAt,
				endedAt: row.endedAt,
			})
			grouped.set(row.characterId, list)
		}

		const now = new Date()
		const sessionEndedAt = session.endedAt
		const sessionEndedMs = sessionEndedAt ? sessionEndedAt.getTime() : null

		const result: SessionRosterRow[] = []
		for (const [characterId, segments] of grouped) {
			// segments are already sorted by startedAt asc
			const first = segments[0]
			const last = segments[segments.length - 1]

			// Total time in fleet = sum of segment durations.
			// For open segments (endedAt null), use session end if session has ended, else now.
			let totalMs = 0
			for (const seg of segments) {
				const segEnd = seg.endedAt ? seg.endedAt.getTime() : sessionEndedMs ?? now.getTime()
				const segDur = segEnd - seg.startedAt.getTime()
				if (segDur > 0) totalMs += segDur
			}

			// Did the pilot leave before session end?
			// - If session is active: pilot left iff last segment is closed (endedAt set).
			// - If session is ended: pilot stayed to end iff last segment's endedAt
			//   equals the session's endedAt (finalize closed it). If their last
			//   segment closed earlier, they left.
			let stayedToEnd: boolean
			let leftAt: Date | null
			if (sessionEndedAt) {
				if (last.endedAt && last.endedAt.getTime() < sessionEndedAt.getTime() - 1000) {
					stayedToEnd = false
					leftAt = last.endedAt
				} else {
					stayedToEnd = true
					leftAt = null
				}
			} else {
				// Active session
				if (last.endedAt) {
					stayedToEnd = false
					leftAt = last.endedAt
				} else {
					stayedToEnd = true
					leftAt = null
				}
			}

			const distinctShips = new Set(segments.map((s) => s.shipTypeId)).size

			result.push({
				characterId,
				firstSeenAt: first.startedAt.toISOString(),
				leftAt: leftAt ? leftAt.toISOString() : null,
				totalSeconds: Math.max(0, Math.round(totalMs / 1000)),
				shipsFlown: distinctShips,
				lastShipTypeId: last.shipTypeId,
				stayedToEnd,
			})
		}

		// Default sort: longest in fleet first
		result.sort((a, b) => b.totalSeconds - a.totalSeconds)
		return result
	}

	async kickTrackingSessionMember(args: {
		sessionId: string
		memberCharacterId: string
	}): Promise<KickTrackingSessionMemberResult> {
		const [result] = await this.kickTrackingSessionMembers({
			sessionId: args.sessionId,
			memberCharacterIds: [args.memberCharacterId],
		})
		return (
			result ?? {
				characterId: args.memberCharacterId,
				success: false,
				error: 'Kick operation did not produce a result',
			}
		)
	}

	async kickTrackingSessionMembers(args: {
		sessionId: string
		memberCharacterIds: string[]
	}): Promise<KickTrackingSessionMemberResult[]> {
		const uniqueMemberIds = Array.from(
			new Set(args.memberCharacterIds.map((id) => id.trim()).filter(Boolean))
		)
		if (uniqueMemberIds.length === 0) return []

		const [session] = await this.db
			.select({
				id: fleetTrackingSessions.id,
				status: fleetTrackingSessions.status,
				fleetId: fleetTrackingSessions.fleetId,
				characterId: fleetTrackingSessions.characterId,
			})
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, args.sessionId))
			.limit(1)

		if (!session) {
			return uniqueMemberIds.map((characterId) => ({
				characterId,
				success: false,
				error: 'Session not found',
			}))
		}
		if (session.status !== 'active') {
			return uniqueMemberIds.map((characterId) => ({
				characterId,
				success: false,
				error: 'Session is not active',
			}))
		}
		if (!session.fleetId) {
			return uniqueMemberIds.map((characterId) => ({
				characterId,
				success: false,
				error: 'Tracked session has no active fleet ID',
			}))
		}

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const accessToken = await tokenStore.getAccessToken(session.characterId)
		if (!accessToken) {
			return uniqueMemberIds.map((characterId) => ({
				characterId,
				success: false,
				error: 'Fleet commander ESI access expired',
			}))
		}

		const results: KickTrackingSessionMemberResult[] = []
		for (const memberCharacterId of uniqueMemberIds) {
			try {
				await this.esiRateLimits.request({
					path: `/latest/fleets/${session.fleetId}/members/${memberCharacterId}/?datasource=tranquility`,
					userKey: buildEsiUserKey(this.env.EVE_SSO_CLIENT_ID, session.characterId),
					method: 'DELETE',
					accessToken,
					parse: async () => undefined,
					buildError: ({ response, body }) =>
						new Error(this.formatFleetKickError(response, body)),
				})

				results.push({ characterId: memberCharacterId, success: true })
			} catch (error) {
				if (this.isEsiRateLimitError(error)) {
					results.push({
						characterId: memberCharacterId,
						success: false,
						error: 'ESI is temporarily rate limited. Please retry shortly.',
					})
					continue
				}
				results.push({
					characterId: memberCharacterId,
					success: false,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		return results
	}

	// ===== Stats / analytics =====

	/**
	 * Org-wide overview metrics within a time window.
	 *
	 * Sessions are filtered by `startedAt` falling inside the window.
	 * Ship time and "Hours in fleet" use ship-event segments clamped to the window.
	 */
	async getStatsOverview(range: StatsRange): Promise<StatsOverviewResult> {
		const from = new Date(range.from)
		const to = new Date(range.to)

		// Totals from sessions
		const sessionTotals = await this.db
			.select({
				sessions: sql<number>`count(*)::int`,
				avgDuration: sql<number | null>`avg(${fleetSummaries.durationMinutes})::float`,
				avgPeak: sql<number | null>`avg(${fleetSummaries.peakMemberCount})::float`,
				maxPeak: sql<number | null>`max(${fleetSummaries.peakMemberCount})::int`,
				totalMinutes: sql<number>`coalesce(sum(${fleetSummaries.durationMinutes}), 0)::int`,
			})
			.from(fleetSummaries)
			.where(
				and(gte(fleetSummaries.startedAt, from), lt(fleetSummaries.startedAt, to))
			)

		// Active (still running) sessions started in the window — include their
		// session count but their durations aren't in fleet_summaries yet.
		const activeSessions = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(fleetTrackingSessions)
			.where(
				and(
					eq(fleetTrackingSessions.status, 'active'),
					gte(fleetTrackingSessions.startedAt, from),
					lt(fleetTrackingSessions.startedAt, to)
				)
			)

		const sessions = (sessionTotals[0]?.sessions ?? 0) + (activeSessions[0]?.count ?? 0)

		// Unique pilots and join count from member history
		const memberAgg = await this.db
			.select({
				uniquePilots: sql<number>`count(distinct ${fleetMemberHistory.characterId})::int`,
				totalJoins: sql<number>`count(*) filter (where ${fleetMemberHistory.eventType} = 'join')::int`,
			})
			.from(fleetMemberHistory)
			.where(
				and(
					gte(fleetMemberHistory.eventTimestamp, from),
					lt(fleetMemberHistory.eventTimestamp, to)
				)
			)

		// Top FCs by session count (characterId of the FC on each session)
		const topFCs = await this.db
			.select({
				characterId: fleetTrackingSessions.characterId,
				count: sql<number>`count(*)::int`,
			})
			.from(fleetTrackingSessions)
			.where(
				and(
					gte(fleetTrackingSessions.startedAt, from),
					lt(fleetTrackingSessions.startedAt, to)
				)
			)
			.groupBy(fleetTrackingSessions.characterId)
			.orderBy(desc(sql`count(*)`))
			.limit(10)

		// Top pilots by minutes in fleet (sum of ship-event durations clamped to window)
		const topPilots = await this.db
			.select({
				characterId: fleetMemberShipEvents.characterId,
				minutesInFleet: sql<number>`
					sum(
						extract(epoch from
							least(coalesce(${fleetMemberShipEvents.endedAt}, ${to.toISOString()}::timestamp), ${to.toISOString()}::timestamp)
							- greatest(${fleetMemberShipEvents.startedAt}, ${from.toISOString()}::timestamp)
						) / 60
					)::int
				`,
			})
			.from(fleetMemberShipEvents)
			.where(
				and(
					lt(fleetMemberShipEvents.startedAt, to),
					sql`(${fleetMemberShipEvents.endedAt} IS NULL OR ${fleetMemberShipEvents.endedAt} > ${from})`
				)
			)
			.groupBy(fleetMemberShipEvents.characterId)
			.orderBy(desc(sql`sum(extract(epoch from least(coalesce(${fleetMemberShipEvents.endedAt}, ${to.toISOString()}::timestamp), ${to.toISOString()}::timestamp) - greatest(${fleetMemberShipEvents.startedAt}, ${from.toISOString()}::timestamp)))`))
			.limit(10)

		// Top ships by total clamped time in window. Includes any ship-event that
		// overlaps the window (started before to AND not ended before from) so
		// long-flown rare ships aren't excluded just because they started before
		// the window opened.
		const toIsoOverview = to.toISOString()
		const fromIsoOverview = from.toISOString()
		const topShips = await this.db
			.select({
				shipTypeId: fleetMemberShipEvents.shipTypeId,
				totalMinutes: sql<number>`
					sum(
						extract(epoch from
							least(coalesce(${fleetMemberShipEvents.endedAt}, ${toIsoOverview}::timestamp), ${toIsoOverview}::timestamp)
							- greatest(${fleetMemberShipEvents.startedAt}, ${fromIsoOverview}::timestamp)
						) / 60
					)::int
				`,
			})
			.from(fleetMemberShipEvents)
			.where(
				and(
					lt(fleetMemberShipEvents.startedAt, to),
					sql`(${fleetMemberShipEvents.endedAt} IS NULL OR ${fleetMemberShipEvents.endedAt} > ${from})`
				)
			)
			.groupBy(fleetMemberShipEvents.shipTypeId)
			.orderBy(
				desc(sql`
					sum(
						extract(epoch from
							least(coalesce(${fleetMemberShipEvents.endedAt}, ${toIsoOverview}::timestamp), ${toIsoOverview}::timestamp)
							- greatest(${fleetMemberShipEvents.startedAt}, ${fromIsoOverview}::timestamp)
						)
					)
				`)
			)
			.limit(10)

		// Sessions per day (by started_at, date part)
		const perDay = await this.db
			.select({
				day: sql<string>`to_char(${fleetTrackingSessions.startedAt}, 'YYYY-MM-DD')`,
				count: sql<number>`count(*)::int`,
			})
			.from(fleetTrackingSessions)
			.where(
				and(
					gte(fleetTrackingSessions.startedAt, from),
					lt(fleetTrackingSessions.startedAt, to)
				)
			)
			.groupBy(sql`to_char(${fleetTrackingSessions.startedAt}, 'YYYY-MM-DD')`)
			.orderBy(sql`to_char(${fleetTrackingSessions.startedAt}, 'YYYY-MM-DD')`)

		return {
			totals: {
				sessions,
				totalMinutes: sessionTotals[0]?.totalMinutes ?? 0,
				uniquePilots: memberAgg[0]?.uniquePilots ?? 0,
				totalJoins: memberAgg[0]?.totalJoins ?? 0,
				avgDurationMinutes: sessionTotals[0]?.avgDuration ?? null,
				avgPeakMembers: sessionTotals[0]?.avgPeak ?? null,
				largestFleetPeak: sessionTotals[0]?.maxPeak ?? null,
			},
			topFCs: topFCs.map((r) => ({ characterId: r.characterId, count: r.count })),
			topPilots: topPilots.map((r) => ({
				characterId: r.characterId,
				minutesInFleet: r.minutesInFleet ?? 0,
			})),
			topShips: topShips.map((r) => ({
				shipTypeId: r.shipTypeId,
				totalMinutes: r.totalMinutes ?? 0,
			})),
			sessionsPerDay: perDay.map((r) => ({ day: r.day, count: r.count })),
		}
	}

	/**
	 * Stats for one character within the window.
	 */
	async getStatsForCharacter(
		characterId: string,
		range: StatsRange
	): Promise<CharacterStatsResult> {
		const records = await this.getStatsForCharacters([characterId], range)
		return (
			records[characterId] ?? {
				totals: {
					fleetsJoined: 0,
					minutesInFleet: 0,
					timesFC: 0,
					avgFleetDurationMinutes: null,
				},
				shipsFlown: [],
				recentSessions: [],
			}
		)
	}

	/**
	 * Stats for a batch of character IDs within the window.
	 * Used by user-level and corp-level rollups.
	 */
	async getStatsForCharacters(
		characterIds: string[],
		range: StatsRange
	): Promise<Record<string, CharacterStatsResult>> {
		if (characterIds.length === 0) return {}

		const from = new Date(range.from)
		const to = new Date(range.to)
		const fromIso = from.toISOString()
		const toIso = to.toISOString()

		// Distinct sessions joined per character, derived from join events
		const fleetsJoinedRows = await this.db
			.select({
				characterId: fleetMemberHistory.characterId,
				count: sql<number>`count(distinct ${fleetMemberHistory.fleetId})::int`,
			})
			.from(fleetMemberHistory)
			.where(
				and(
					inArray(fleetMemberHistory.characterId, characterIds),
					eq(fleetMemberHistory.eventType, 'join'),
					gte(fleetMemberHistory.eventTimestamp, from),
					lt(fleetMemberHistory.eventTimestamp, to)
				)
			)
			.groupBy(fleetMemberHistory.characterId)

		// Minutes-in-fleet per character (clamped to window)
		const minutesRows = await this.db
			.select({
				characterId: fleetMemberShipEvents.characterId,
				minutes: sql<number>`
					sum(
						extract(epoch from
							least(coalesce(${fleetMemberShipEvents.endedAt}, ${toIso}::timestamp), ${toIso}::timestamp)
							- greatest(${fleetMemberShipEvents.startedAt}, ${fromIso}::timestamp)
						) / 60
					)::int
				`,
			})
			.from(fleetMemberShipEvents)
			.where(
				and(
					inArray(fleetMemberShipEvents.characterId, characterIds),
					lt(fleetMemberShipEvents.startedAt, to),
					sql`(${fleetMemberShipEvents.endedAt} IS NULL OR ${fleetMemberShipEvents.endedAt} > ${from})`
				)
			)
			.groupBy(fleetMemberShipEvents.characterId)

		// Times FC'd: sessions where this character was the FC
		const fcRows = await this.db
			.select({
				characterId: fleetTrackingSessions.characterId,
				count: sql<number>`count(*)::int`,
			})
			.from(fleetTrackingSessions)
			.where(
				and(
					inArray(fleetTrackingSessions.characterId, characterIds),
					gte(fleetTrackingSessions.startedAt, from),
					lt(fleetTrackingSessions.startedAt, to)
				)
			)
			.groupBy(fleetTrackingSessions.characterId)

		// Ships flown per character — total time in each ship (clamped to window)
		const shipRows = await this.db
			.select({
				characterId: fleetMemberShipEvents.characterId,
				shipTypeId: fleetMemberShipEvents.shipTypeId,
				totalMinutes: sql<number>`
					sum(
						extract(epoch from
							least(coalesce(${fleetMemberShipEvents.endedAt}, ${toIso}::timestamp), ${toIso}::timestamp)
							- greatest(${fleetMemberShipEvents.startedAt}, ${fromIso}::timestamp)
						) / 60
					)::int
				`,
			})
			.from(fleetMemberShipEvents)
			.where(
				and(
					inArray(fleetMemberShipEvents.characterId, characterIds),
					lt(fleetMemberShipEvents.startedAt, to),
					sql`(${fleetMemberShipEvents.endedAt} IS NULL OR ${fleetMemberShipEvents.endedAt} > ${from})`
				)
			)
			.groupBy(fleetMemberShipEvents.characterId, fleetMemberShipEvents.shipTypeId)
			.orderBy(
				desc(sql`
					sum(
						extract(epoch from
							least(coalesce(${fleetMemberShipEvents.endedAt}, ${toIso}::timestamp), ${toIso}::timestamp)
							- greatest(${fleetMemberShipEvents.startedAt}, ${fromIso}::timestamp)
						)
					)
				`)
			)

		// Recent sessions joined by each character
		const recentRows = await this.db
			.select({
				characterId: fleetMemberShipEvents.characterId,
				sessionId: fleetMemberShipEvents.trackingSessionId,
				sessionName: fleetTrackingSessions.name,
				fleetId: fleetTrackingSessions.fleetId,
				fcCharacterId: fleetTrackingSessions.characterId,
				startedAt: fleetTrackingSessions.startedAt,
				endedAt: fleetTrackingSessions.endedAt,
				totalMinutes: sql<number>`
					sum(
						extract(epoch from
							least(coalesce(${fleetMemberShipEvents.endedAt}, ${toIso}::timestamp), ${toIso}::timestamp)
							- greatest(${fleetMemberShipEvents.startedAt}, ${fromIso}::timestamp)
						) / 60
					)::int
				`,
				shipsFlown: sql<number>`count(distinct ${fleetMemberShipEvents.shipTypeId})::int`,
			})
			.from(fleetMemberShipEvents)
			.innerJoin(
				fleetTrackingSessions,
				eq(fleetMemberShipEvents.trackingSessionId, fleetTrackingSessions.id)
			)
			.where(
				and(
					inArray(fleetMemberShipEvents.characterId, characterIds),
					lt(fleetMemberShipEvents.startedAt, to),
					sql`(${fleetMemberShipEvents.endedAt} IS NULL OR ${fleetMemberShipEvents.endedAt} > ${from})`
				)
			)
			.groupBy(
				fleetMemberShipEvents.characterId,
				fleetMemberShipEvents.trackingSessionId,
				fleetTrackingSessions.id,
				fleetTrackingSessions.name,
				fleetTrackingSessions.fleetId,
				fleetTrackingSessions.characterId,
				fleetTrackingSessions.startedAt,
				fleetTrackingSessions.endedAt
			)
			.orderBy(desc(fleetTrackingSessions.startedAt))
			.limit(characterIds.length * 20)

		// Stitch results by character
		const out: Record<string, CharacterStatsResult> = {}
		const ensure = (cid: string): CharacterStatsResult => {
			if (!out[cid]) {
				out[cid] = {
					totals: {
						fleetsJoined: 0,
						minutesInFleet: 0,
						timesFC: 0,
						avgFleetDurationMinutes: null,
					},
					shipsFlown: [],
					recentSessions: [],
				}
			}
			return out[cid]
		}

		for (const row of fleetsJoinedRows) {
			ensure(row.characterId).totals.fleetsJoined = row.count
		}
		for (const row of minutesRows) {
			ensure(row.characterId).totals.minutesInFleet = row.minutes ?? 0
		}
		for (const row of fcRows) {
			ensure(row.characterId).totals.timesFC = row.count
		}
		for (const row of shipRows) {
			ensure(row.characterId).shipsFlown.push({
				shipTypeId: row.shipTypeId,
				totalMinutes: row.totalMinutes ?? 0,
			})
		}
		for (const row of recentRows) {
			const recent: CharacterRecentSessionRow = {
				sessionId: row.sessionId,
				sessionName: row.sessionName,
				fleetId: row.fleetId,
				wasFC: row.fcCharacterId === row.characterId,
				startedAt: row.startedAt.toISOString(),
				endedAt: row.endedAt ? row.endedAt.toISOString() : null,
				totalMinutes: row.totalMinutes ?? 0,
				shipsFlown: row.shipsFlown,
			}
			ensure(row.characterId).recentSessions.push(recent)
		}

		// Compute avg fleet duration for each character (totalMinutes / fleetsJoined)
		for (const cid of Object.keys(out)) {
			const t = out[cid].totals
			t.avgFleetDurationMinutes =
				t.fleetsJoined > 0 ? Math.round(t.minutesInFleet / t.fleetsJoined) : null
			// Cap each character to 10 recent sessions
			out[cid].recentSessions = out[cid].recentSessions.slice(0, 10)
		}

		return out
	}

	/**
	 * Top corporations by distinct pilot count, derived from the
	 * historical corporation snapshot stored on join events.
	 */
	async getCorpRollupForOverview(range: StatsRange): Promise<CorpRollupRow[]> {
		const from = new Date(range.from)
		const to = new Date(range.to)

		const rows = await this.db
			.select({
				corporationId: fleetMemberHistory.corporationId,
				pilotCount: sql<number>`count(distinct ${fleetMemberHistory.characterId})::int`,
			})
			.from(fleetMemberHistory)
			.where(
				and(
					eq(fleetMemberHistory.eventType, 'join'),
					gte(fleetMemberHistory.eventTimestamp, from),
					lt(fleetMemberHistory.eventTimestamp, to),
					isNotNull(fleetMemberHistory.corporationId)
				)
			)
			.groupBy(fleetMemberHistory.corporationId)
			.orderBy(desc(sql`count(distinct ${fleetMemberHistory.characterId})`))
			.limit(10)

		return rows
			.filter((r): r is { corporationId: string; pilotCount: number } => r.corporationId !== null)
			.map((r) => ({ corporationId: r.corporationId, pilotCount: r.pilotCount }))
	}

	/**
	 * Distinct character IDs that joined a fleet while in the given corporation
	 * during the window. Used to seed the corp-stats per-character rollup.
	 */
	async getCharactersByCorpInWindow(
		corporationId: string,
		range: StatsRange
	): Promise<string[]> {
		const from = new Date(range.from)
		const to = new Date(range.to)

		const rows = await this.db
			.selectDistinct({ characterId: fleetMemberHistory.characterId })
			.from(fleetMemberHistory)
			.where(
				and(
					eq(fleetMemberHistory.corporationId, corporationId),
					eq(fleetMemberHistory.eventType, 'join'),
					gte(fleetMemberHistory.eventTimestamp, from),
					lt(fleetMemberHistory.eventTimestamp, to)
				)
			)

		return rows.map((r) => r.characterId)
	}

	/**
	 * Search characters that have appeared in any tracked fleet by name (case-insensitive
	 * prefix/substring match). Returns up to `limit` distinct (characterId, characterName)
	 * pairs from fleet_member_history. Used for the stats-page autocomplete.
	 */
	async searchTrackedCharacters(
		query: string,
		limit = 20
	): Promise<Array<{ characterId: string; characterName: string }>> {
		const q = query.trim()
		if (q.length < 2) return []

		const rows = await this.db
			.selectDistinct({
				characterId: fleetMemberHistory.characterId,
				characterName: fleetMemberHistory.characterName,
			})
			.from(fleetMemberHistory)
			.where(
				and(
					isNotNull(fleetMemberHistory.characterName),
					sql`${fleetMemberHistory.characterName} ILIKE ${`%${q}%`}`
				)
			)
			.limit(limit)

		return rows
			.filter((r): r is { characterId: string; characterName: string } => r.characterName !== null)
			.map((r) => ({ characterId: r.characterId, characterName: r.characterName }))
	}

	/**
	 * List all distinct corporation IDs that have appeared in any tracked fleet.
	 * Returns plain IDs; the caller resolves names via the ESI resolver.
	 * Used for the stats-page corp autocomplete (client-side filters on names).
	 */
	async listTrackedCorporationIds(): Promise<string[]> {
		const rows = await this.db
			.selectDistinct({ corporationId: fleetMemberHistory.corporationId })
			.from(fleetMemberHistory)
			.where(isNotNull(fleetMemberHistory.corporationId))

		return rows
			.filter((r): r is { corporationId: string } => r.corporationId !== null)
			.map((r) => r.corporationId)
	}

	/**
	 * Search tracked corporation IDs from historical join events.
	 * Uses DB-side filtering on corporation ID text so core can resolve names for
	 * a bounded candidate set instead of scanning all tracked corporations.
	 */
	async searchTrackedCorporationIds(query: string, limit = 100): Promise<string[]> {
		const q = query.trim()
		if (q.length < 2) return []

		const rows = await this.db
			.selectDistinct({ corporationId: fleetMemberHistory.corporationId })
			.from(fleetMemberHistory)
			.where(
				and(
					isNotNull(fleetMemberHistory.corporationId),
					sql`${fleetMemberHistory.corporationId} ILIKE ${`%${q}%`}`
				)
			)
			.limit(limit)

		return rows
			.filter((r): r is { corporationId: string } => r.corporationId !== null)
			.map((r) => r.corporationId)
	}

	/**
	 * Filter a provided list of corporation IDs down to those present in tracked
	 * fleet history.
	 */
	async filterTrackedCorporationIds(corporationIds: string[]): Promise<string[]> {
		const ids = Array.from(new Set(corporationIds.map((id) => id.trim()).filter(Boolean)))
		if (ids.length === 0) return []

		const rows = await this.db
			.selectDistinct({ corporationId: fleetMemberHistory.corporationId })
			.from(fleetMemberHistory)
			.where(
				and(
					isNotNull(fleetMemberHistory.corporationId),
					inArray(fleetMemberHistory.corporationId, ids)
				)
			)

		return rows
			.filter((r): r is { corporationId: string } => r.corporationId !== null)
			.map((r) => r.corporationId)
	}

	/**
	 * Convert a DB row to the RPC-serialized TrackingSession shape.
	 * Dates become ISO strings so they survive the DO RPC boundary cleanly.
	 */
	private serializeSession = (
		row: typeof fleetTrackingSessions.$inferSelect
	): TrackingSession => ({
		id: row.id,
		name: row.name,
		characterId: row.characterId,
		startedByUserId: row.startedByUserId,
		fleetId: row.fleetId,
		status: row.status as TrackingSession['status'],
		startedAt: row.startedAt.toISOString(),
		endedAt: row.endedAt ? row.endedAt.toISOString() : null,
		endedReason: (row.endedReason as TrackingSession['endedReason']) ?? null,
		endedByUserId: row.endedByUserId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	})

	/**
	 * WebSocket message handler (Hibernation API)
	 * Called when a WebSocket message is received
	 */
	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
		try {
			const data =
				typeof message === 'string'
					? JSON.parse(message)
					: JSON.parse(new TextDecoder().decode(message))

			console.log('WebSocket message received:', data)

			switch (data.type) {
				case 'ping':
					ws.send(JSON.stringify({ type: 'pong', payload: Date.now() }))
					break

				case 'subscribe':
					// Handle subscription logic
					ws.send(JSON.stringify({ type: 'subscribed' }))
					break

				case 'unsubscribe':
					// Handle unsubscribe logic
					ws.send(JSON.stringify({ type: 'unsubscribed' }))
					break

				default:
					ws.send(JSON.stringify({ type: 'error', payload: 'Unknown message type' }))
			}
		} catch (error) {
			console.error('Error processing WebSocket message:', error)
			ws.send(JSON.stringify({ type: 'error', payload: 'Invalid message format' }))
		}
	}

	/**
	 * WebSocket close handler (Hibernation API)
	 * Called when a WebSocket connection is closed
	 */
	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean
	): Promise<void> {
		console.log('WebSocket closed:', { code, reason, wasClean })
		// Cleanup logic here
	}

	/**
	 * WebSocket error handler (Hibernation API)
	 * Called when a WebSocket error occurs
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		console.error('WebSocket error:', error)
	}

	/**
	 * Alarm handler - Watchdog for FleetMonitor instances
	 * Checks all active FleetMonitor instances to ensure they're updating regularly
	 * Runs every 2 minutes to detect stale monitors
	 */
	async alarm(): Promise<void> {
		logger.info('[FleetsDO Watchdog] Starting FleetMonitor health check', {
			timestamp: new Date().toISOString(),
		})

		try {
			// Get all active fleets from cache (excluding not found fleets)
			const activeFleets = await this.db
				.select({
					fleetId: fleetStateCache.fleetId,
					fleetBossId: fleetStateCache.fleetBossId,
					lastChecked: fleetStateCache.lastChecked,
				})
				.from(fleetStateCache)
				.where(and(eq(fleetStateCache.notFound, false), eq(fleetStateCache.isActive, true)))

			logger.info('[FleetsDO Watchdog] Found active fleets to check', {
				count: activeFleets.length,
			})

			if (activeFleets.length === 0) {
				logger.info('[FleetsDO Watchdog] No active fleets to monitor')
				await this.scheduleNextWatchdog()
				return
			}

			// Check each FleetMonitor instance
			const now = Date.now()
			const staleThreshold = 2 * 60 * 1000 // 2 minutes in milliseconds
			const staleFleets: Array<{ fleetId: string; lastChecked: Date | null; ageMs: number }> = []
			let recoveredCount = 0

			for (const fleet of activeFleets) {
				try {
					// Get the FleetMonitor DO stub for this fleet
					const fleetMonitorStub = getStub<FleetMonitor>(
						this.env.FLEET_MONITOR,
						`fleet-${fleet.fleetId}`
					)

					// Get the monitor's internal state
					const monitorState = await fleetMonitorStub.getMonitorState()

					if (!monitorState || !monitorState.isInitialized) {
						logger.warn('[FleetsDO Watchdog] FleetMonitor not initialized', {
							fleetId: fleet.fleetId,
						})
						const recovered = await this.recoverFleetMonitorSession(fleet.fleetId)
						if (recovered) {
							recoveredCount += 1
						}
						continue
					}

					// Check if lastChecked is stale
					if (monitorState.lastChecked) {
						const lastCheckedTime = new Date(monitorState.lastChecked).getTime()
						const ageMs = now - lastCheckedTime

						if (ageMs > staleThreshold) {
							staleFleets.push({
								fleetId: fleet.fleetId,
								lastChecked: new Date(monitorState.lastChecked),
								ageMs,
							})

							logger.error('[FleetsDO Watchdog] Stale FleetMonitor detected', {
								fleetId: fleet.fleetId,
								lastChecked: monitorState.lastChecked,
								ageMs,
								ageSeconds: Math.round(ageMs / 1000),
								thresholdMs: staleThreshold,
							})

							const recovered = await this.recoverFleetMonitorSession(fleet.fleetId)
							if (recovered) {
								recoveredCount += 1
							}
						} else {
							logger.debug('[FleetsDO Watchdog] FleetMonitor is healthy', {
								fleetId: fleet.fleetId,
								lastChecked: monitorState.lastChecked,
								ageMs,
								ageSeconds: Math.round(ageMs / 1000),
							})
						}
					} else {
						logger.warn('[FleetsDO Watchdog] FleetMonitor has no lastChecked timestamp', {
							fleetId: fleet.fleetId,
						})
						const recovered = await this.recoverFleetMonitorSession(fleet.fleetId)
						if (recovered) {
							recoveredCount += 1
						}
					}
				} catch (error) {
					logger.error('[FleetsDO Watchdog] Failed to check FleetMonitor', {
						fleetId: fleet.fleetId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			// Log summary
			if (staleFleets.length > 0) {
				logger.error('[FleetsDO Watchdog] Watchdog check completed with stale monitors', {
					totalChecked: activeFleets.length,
					staleCount: staleFleets.length,
					recoveredCount,
					staleFleets: staleFleets.map((f) => ({
						fleetId: f.fleetId,
						ageSeconds: Math.round(f.ageMs / 1000),
					})),
				})
			} else {
				logger.info('[FleetsDO Watchdog] All FleetMonitors are healthy', {
					totalChecked: activeFleets.length,
					recoveredCount,
				})
			}
		} catch (error) {
			logger.error('[FleetsDO Watchdog] Watchdog check failed', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
		} finally {
			// Always reschedule the watchdog
			await this.scheduleNextWatchdog()
		}
	}

	/**
	 * Attempt to self-heal a FleetMonitor by re-initializing it from the active
	 * tracking session for the fleet.
	 */
	private async recoverFleetMonitorSession(fleetId: string): Promise<boolean> {
		try {
			const [activeSession] = await this.db
				.select({
					id: fleetTrackingSessions.id,
					characterId: fleetTrackingSessions.characterId,
				})
				.from(fleetTrackingSessions)
				.where(
					and(
						eq(fleetTrackingSessions.fleetId, fleetId),
						eq(fleetTrackingSessions.status, 'active')
					)
				)
				.orderBy(desc(fleetTrackingSessions.startedAt))
				.limit(1)

			if (!activeSession) {
				logger.warn('[FleetsDO Watchdog] Cannot recover monitor - no active session', {
					fleetId,
				})
				return false
			}

			const fleetMonitorStub = getStub<FleetMonitor>(this.env.FLEET_MONITOR, `fleet-${fleetId}`)
			await fleetMonitorStub.initializeMonitoring(
				fleetId,
				activeSession.characterId,
				activeSession.id,
				true
			)

			logger.info('[FleetsDO Watchdog] Recovered FleetMonitor via forced re-initialize', {
				fleetId,
				sessionId: activeSession.id,
				characterId: activeSession.characterId,
			})
			return true
		} catch (error) {
			logger.error('[FleetsDO Watchdog] Failed to recover FleetMonitor', {
				fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
			return false
		}
	}

	/**
	 * Schedule the next watchdog alarm to run 2 minutes from now
	 */
	private async scheduleNextWatchdog(): Promise<void> {
		const twoMinutes = 2 * 60 * 1000 // 2 minutes in milliseconds
		const nextAlarmTime = Date.now() + twoMinutes

		await this.state.storage.setAlarm(nextAlarmTime)

		logger.debug('[FleetsDO Watchdog] Next watchdog scheduled', {
			nextAlarmTime: new Date(nextAlarmTime).toISOString(),
		})
	}

	/**
	 * Start the watchdog (schedules the first alarm)
	 * Can be called manually or will start automatically
	 */
	async startWatchdog(): Promise<void> {
		logger.info('[FleetsDO Watchdog] Starting watchdog')
		await this.scheduleNextWatchdog()
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		// WebSocket upgrade handling
		if (request.headers.get('Upgrade') === 'websocket') {
			const pair = new WebSocketPair()
			const [client, server] = Object.values(pair)

			// Accept the WebSocket connection using hibernation API
			this.ctx.acceptWebSocket(server)

			return new Response(null, {
				status: 101,
				webSocket: client,
			})
		}

		// Start watchdog on first access if not already running
		// This ensures the watchdog starts automatically
		try {
			await this.startWatchdog()
		} catch (error) {
			// Ignore errors if alarm is already scheduled
			logger.debug('[FleetsDO] Watchdog may already be running', {
				error: error instanceof Error ? error.message : String(error),
			})
		}

		return new Response('Fleets Durable Object', { status: 200 })
	}
}
