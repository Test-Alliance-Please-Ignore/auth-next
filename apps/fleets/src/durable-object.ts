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
	isNotNull,
	isNull,
	lt,
	lte,
	or,
	sql,
} from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { buildEsiUserKey, EsiRateLimitGuard, EsiRateLimitStore } from '@repo/esi-rate-limit'
import { createEveCharacterId } from '@repo/eve-types'
import {
	esiGetCharacterFleetInformationSchema,
	esiGetFleetInformationSchema,
	esiGetFleetMembersSchema,
	StartTrackingSessionError,
} from '@repo/fleets'
import { logger } from '@repo/hono-helpers'
import { parseDateOrNull } from '@repo/worker-utils'

import {
	fleetCommanderAccessAnchors,
	fleetCommanderEvents,
	fleetInvitations,
	fleetMemberHistory,
	fleetMemberShipEvents,
	fleetMemberships,
	fleetSummaries,
	fleetTrackingSessionEvents,
	fleetTrackingSessions,
	schema,
} from './db/schema'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { EveCharacterId } from '@repo/eve-types'
import type {
	CharacterRecentSessionRow,
	CharacterStatsResult,
	CorpRollupRow,
	EsiGetCharacterFleetInformation,
	EsiGetFleetInformation,
	EsiGetFleetMembers,
	FleetDetailsResponse,
	FleetInformation,
	FleetJoinResult,
	FleetMonitor,
	FleetMonitorState,
	Fleets,
	KickTrackingSessionMemberResult,
	QuickJoinCreationResult,
	QuickJoinValidationResult,
	SessionCommanderEvent,
	SessionCurrentMemberRow,
	SessionLiveMemberLocation,
	SessionLiveSnapshotResult,
	SessionMemberShipHistoryRow,
	SessionRosterRow,
	SessionSummary,
	SessionTimelineResult,
	SessionTimelineRow,
	SrpFleetSessionDetails,
	StartTrackingSessionResult,
	StatsOverviewResult,
	StatsRange,
	TrackingSession,
	TrackingSessionListFilter,
	TrackingSessionListResult,
} from '@repo/fleets'
import type { Universe } from '@repo/universe'
import type { Env } from './context'

const LIVE_FLEET_ESI_OPTIONS = { cacheMode: 'no-store' } as const

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

	private formatFleetKickError(response: Pick<Response, 'status'>, details = ''): string {
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

	private async recordSessionLifecycleEvent(args: {
		fleetId: string
		trackingSessionId: string
		characterId: string
		previousCharacterId?: string | null
		eventType: 'started' | 'ended' | 'resumed'
		observedAt: Date
	}): Promise<void> {
		const { fleetId, trackingSessionId, characterId, previousCharacterId, eventType, observedAt } =
			args

		await this.db.insert(fleetTrackingSessionEvents).values({
			fleetId,
			trackingSessionId,
			previousCharacterId: previousCharacterId ?? null,
			characterId,
			eventType,
			observedAt,
			createdAt: observedAt,
		})
	}

	private async getMonitorStateForFleet(
		fleetId: string
	): Promise<FleetMonitorState | null> {
		try {
			const monitorStub = getStub<FleetMonitor>(this.env.FLEET_MONITOR, `fleet-${fleetId}`)
			const state = await monitorStub.getMonitorState()
			if (!state || state.fleetId !== fleetId || !state.isInitialized) {
				return null
			}
			return state
		} catch (error) {
			logger.warn('[FleetsDO] Failed to read FleetMonitor state', {
				fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
			return null
		}
	}

	private async getLatestCommanderBySessionIds(sessionIds: string[]): Promise<Map<string, string>> {
		if (sessionIds.length === 0) return new Map()

		const rows = await this.db
			.select({
				trackingSessionId: fleetCommanderEvents.trackingSessionId,
				commanderCharacterId: fleetCommanderEvents.commanderCharacterId,
			})
			.from(fleetCommanderEvents)
			.where(inArray(fleetCommanderEvents.trackingSessionId, sessionIds))
			.orderBy(desc(fleetCommanderEvents.observedAt))

		const latestBySession = new Map<string, string>()
		for (const row of rows) {
			if (!row.trackingSessionId) continue
			if (!latestBySession.has(row.trackingSessionId)) {
				latestBySession.set(row.trackingSessionId, row.commanderCharacterId)
			}
		}
		return latestBySession
	}

	private getEffectiveSessionStatus(session: {
		status: string
		endedAt: Date | null
	}): TrackingSession['status'] {
		return session.status === 'active' && session.endedAt === null ? 'active' : 'ended'
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
				characterId,
				LIVE_FLEET_ESI_OPTIONS
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

			// Keep this path independent from fleet-level cache state.
			// A stale fleetId 404 cache must not suppress a valid per-character
			// "is this character in a fleet?" lookup when leadership changes.
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
						role: 'squad_member',
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
		try {
			const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
				`/fleets/${fleetId}/`,
				fleetBossId,
				LIVE_FLEET_ESI_OPTIONS
			)
			esiGetFleetInformationSchema.parse(fleetResponse.data)
		} catch {
			throw new Error('Unable to verify fleet ownership')
		}

		// Generate token
		const token = this.generateToken()
		const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)

		// Store in database
		await this.db.insert(fleetInvitations).values({
			token,
			fleetBossId,
			fleetId,
			expiresAt,
			maxUses: maxUses || null,
			usesCount: 0,
			isActive: true,
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
				invitation.fleetBossId,
				LIVE_FLEET_ESI_OPTIONS
			)
			fleetInfo = esiGetFleetInformationSchema.parse(fleetResponse.data)
		} catch {
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
		const liveMonitorState = await this.getMonitorStateForFleet(fleetId)
		if (liveMonitorState?.notFound && liveMonitorState.notFoundAt) {
			const notFoundAge = Date.now() - new Date(liveMonitorState.notFoundAt).getTime()
			const twentyFourHours = 24 * 60 * 60 * 1000
			if (notFoundAge < twentyFourHours) {
				logger.log(
					`[Fleet ${fleetId}] Marked as 404 in monitor state, skipping ESI query (age: ${Math.round(notFoundAge / 1000 / 60)} minutes)`
				)
				throw new Error('Fleet not found (404)')
			}
		}

		if (liveMonitorState) {
			const monitorStub = getStub<FleetMonitor>(this.env.FLEET_MONITOR, `fleet-${fleetId}`)
			const liveStatus = await monitorStub.getFleetStatus()
			if (liveStatus) {
				return liveStatus
			}
		}

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
			`/fleets/${fleetId}/`,
			characterId,
			LIVE_FLEET_ESI_OPTIONS
		)
		const fleetInfo: EsiGetFleetInformation = esiGetFleetInformationSchema.parse(fleetResponse.data)

		let members: EsiGetFleetMembers | undefined
		let memberCount = 0
		try {
			const membersResponse = await tokenStore.fetchEsi<EsiGetFleetMembers>(
				`/fleets/${fleetId}/members/`,
				characterId,
				LIVE_FLEET_ESI_OPTIONS
			)
			members = esiGetFleetMembersSchema.parse(membersResponse.data)
			memberCount = members.length
		} catch (error) {
			logger.error('[Fleet Members] Failed to parse or fetch:', error)
			members = undefined
		}

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
				invitation.fleetBossId,
				LIVE_FLEET_ESI_OPTIONS
			)

			// Debug logging to see raw ESI response
			logger.log(
				'[Fleet Join] Raw ESI response sample (first member):',
				JSON.stringify(membersResponse.data[0], null, 2)
			)
			logger.log(
				'[Fleet Join] First member station_id type:',
				typeof membersResponse.data[0]?.station_id
			)
			logger.log('[Fleet Join] First member station_id value:', membersResponse.data[0]?.station_id)

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
			logger.error('Failed to check fleet members:', error)
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
			logger.error('Failed to create fleet invitation:', error)
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
		const monitorState = await this.getMonitorStateForFleet(fleetId)
		if (monitorState?.notFound && monitorState.notFoundAt) {
			const notFoundAge = Date.now() - new Date(monitorState.notFoundAt).getTime()
			const twentyFourHours = 24 * 60 * 60 * 1000
			if (notFoundAge < twentyFourHours) {
				logger.log(
					`[Fleet ${fleetId}] Marked as 404 in monitor state, skipping ESI query (age: ${Math.round(notFoundAge / 1000 / 60)} minutes)`
				)
				return false
			}
		}

		if (monitorState) {
			try {
				const monitorStub = getStub<FleetMonitor>(this.env.FLEET_MONITOR, `fleet-${fleetId}`)
				return (await monitorStub.getFleetStatus()) !== null
			} catch (error) {
				logger.warn('[FleetsDO] Fleet monitor lookup failed while checking active state', {
					fleetId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		// Check with ESI
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		let isActive = false
		try {
			const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
				`/fleets/${fleetId}/`,
				characterId,
				LIVE_FLEET_ESI_OPTIONS
			)
			// Validate the response to ensure it's valid fleet data
			esiGetFleetInformationSchema.parse(fleetResponse.data)
			isActive = true
		} catch (error) {
			// Check if it's a 404 error
			const errorMessage = error instanceof Error ? error.message : String(error)
			if (
				errorMessage.includes('404') ||
				errorMessage.includes('Not found') ||
				errorMessage.includes('Not Found')
			) {
				logger.log(`[Fleet ${fleetId}] Received 404 from ESI, marking as not found`)
			}
			isActive = false
		}

		return isActive
	}

	async getFleetCacheStatus(
		fleetId: string
	): Promise<{ notFound: boolean; notFoundAt: Date | null; lastChecked: Date } | null> {
		const state = await this.getMonitorStateForFleet(fleetId)
		if (!state) {
			return null
		}

		return {
			notFound: state.notFound,
			notFoundAt: state.notFoundAt ? new Date(state.notFoundAt) : null,
			lastChecked: new Date(state.lastChecked ?? new Date().toISOString()),
		}
	}

	async getFleetIsRegistered(fleetId: string, characterId: string): Promise<boolean> {
		const monitorState = await this.getMonitorStateForFleet(fleetId)
		if (monitorState) {
			try {
				const monitorStub = getStub<FleetMonitor>(this.env.FLEET_MONITOR, `fleet-${fleetId}`)
				const liveStatus = await monitorStub.getFleetStatus()
				if (liveStatus) {
					return liveStatus.fleetInfo.is_registered
				}
			} catch (error) {
				logger.warn('[FleetsDO] Fleet monitor lookup failed while checking registration', {
					fleetId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		let fleetInfo: EsiGetFleetInformation | null = null

		try {
			const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
				`/fleets/${fleetId}/`,
				characterId,
				LIVE_FLEET_ESI_OPTIONS
			)
			fleetInfo = esiGetFleetInformationSchema.parse(fleetResponse.data)
		} catch {
			fleetInfo = null
		}

		if (fleetInfo) {
			return fleetInfo.is_registered
		}

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
		action?: 'new' | 'take_over'
	}): Promise<StartTrackingSessionResult> {
		const { characterId, startedByUserId, name, action = 'new' } = args

		// 1. Pre-flight ESI
		let fleetInfo: FleetInformation
		try {
			fleetInfo = await this.getCharacterFleetInformation(createEveCharacterId(characterId))
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

		const [mostRecentByFleet] = await this.db
			.select({
				id: fleetTrackingSessions.id,
				status: fleetTrackingSessions.status,
				endedAt: fleetTrackingSessions.endedAt,
				characterId: fleetTrackingSessions.characterId,
			})
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.fleetId, fleetId))
			.orderBy(desc(fleetTrackingSessions.startedAt))
			.limit(1)

		const now = new Date()
		let sessionId: string
		let previousFleetBossCharacterId: string | null = null
		let resumedExistingSession = false
		const mostRecentStatus = mostRecentByFleet
			? this.getEffectiveSessionStatus({
					status: mostRecentByFleet.status,
					endedAt: mostRecentByFleet.endedAt,
				})
			: null

		if (action === 'take_over' && mostRecentByFleet) {
			previousFleetBossCharacterId = mostRecentByFleet.characterId
			const [resumed] = await this.db
				.update(fleetTrackingSessions)
				.set({
					name,
					characterId,
					status: 'active',
					endedAt: null,
					endedReason: null,
					endedByUserId: null,
					updatedAt: now,
				})
				.where(eq(fleetTrackingSessions.id, mostRecentByFleet.id))
				.returning({ id: fleetTrackingSessions.id })

			if (!resumed) {
				throw new Error('Failed to take over tracking session row')
			}

			sessionId = resumed.id
			resumedExistingSession = mostRecentStatus === 'ended'

			if (mostRecentStatus === 'ended') {
				await this.recordSessionLifecycleEvent({
					fleetId,
					trackingSessionId: sessionId,
					characterId,
					previousCharacterId: previousFleetBossCharacterId,
					eventType: 'resumed',
					observedAt: now,
				})
				await this.db.delete(fleetSummaries).where(eq(fleetSummaries.trackingSessionId, sessionId))
			}
		} else {
			if (action === 'new' && mostRecentStatus === 'active') {
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
			sessionId = inserted.id

			await this.recordSessionLifecycleEvent({
				fleetId,
				trackingSessionId: sessionId,
				characterId,
				eventType: 'started',
				observedAt: now,
			})
		}

		// 4. Spawn the FleetMonitor DO and initialize it
		try {
			const fleetMonitorStub = getStub<FleetMonitor>(this.env.FLEET_MONITOR, `fleet-${fleetId}`)
			await fleetMonitorStub.initializeMonitoring(fleetId, characterId, sessionId, {
				force: true,
				previousFleetBossCharacterId,
				resumedExistingSession,
			})
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
			.select({
				id: fleetTrackingSessions.id,
				status: fleetTrackingSessions.status,
				endedAt: fleetTrackingSessions.endedAt,
				fleetId: fleetTrackingSessions.fleetId,
			})
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, sessionId))
			.limit(1)

		if (!session) {
			logger.info('[FleetsDO stopTrackingSession] Session already missing; treating as closed', {
				sessionId,
			})
			return
		}
		const effectiveStatus = this.getEffectiveSessionStatus({
			status: session.status,
			endedAt: session.endedAt,
		})
		if (effectiveStatus !== 'active') {
			logger.info('[FleetsDO stopTrackingSession] Session already ended; treating as closed', {
				sessionId,
				status: effectiveStatus,
			})
			return
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
	async listTrackingSessions(
		filter: TrackingSessionListFilter
	): Promise<TrackingSessionListResult> {
		const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
		const offset = Math.max(filter.offset ?? 0, 0)
		const fleetBossCharacterIds = filter.fleetBossCharacterIds ?? filter.commanderCharacterIds ?? []

		const conditions = []
		const activeSessionCondition = and(
			eq(fleetTrackingSessions.status, 'active'),
			isNull(fleetTrackingSessions.endedAt)
		)
		const closedSessionCondition = and(
			eq(fleetTrackingSessions.status, 'ended'),
			isNotNull(fleetTrackingSessions.endedAt)
		)
		if (filter.characterId) {
			conditions.push(eq(fleetTrackingSessions.characterId, filter.characterId))
		}
		const accessConditions = []
		if (filter.startedByUserId) {
			accessConditions.push(eq(fleetTrackingSessions.startedByUserId, filter.startedByUserId))
		}
		if (fleetBossCharacterIds.length > 0) {
			const commanderMatches = or(
				sql<boolean>`exists (
					select 1
					from fleet_commander_access_anchors
					where fleet_commander_access_anchors.fleet_id = ${fleetTrackingSessions.fleetId}
						and ${or(
							...fleetBossCharacterIds.map((id) =>
								eq(fleetCommanderAccessAnchors.commanderCharacterId, id)
							)
						)}
				)`
			)
			accessConditions.push(commanderMatches)
		}
		if (accessConditions.length === 1) {
			conditions.push(accessConditions[0])
		} else if (accessConditions.length > 1) {
			conditions.push(or(...accessConditions))
		}
		if (filter.status) {
			conditions.push(filter.status === 'active' ? activeSessionCondition : closedSessionCondition)
		}
		if (filter.from) {
			conditions.push(gte(fleetTrackingSessions.startedAt, new Date(filter.from)))
		}
		if (filter.to) {
			conditions.push(lt(fleetTrackingSessions.startedAt, new Date(filter.to)))
		}
		const where = conditions.length > 0 ? and(...conditions) : undefined

		const items = await this.db
			.select({
				session: fleetTrackingSessions,
			})
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
		const commanderMap = await this.getLatestCommanderBySessionIds(
			items.map((row) => row.session.id)
		)

		return {
			items: items.map((row) =>
				this.serializeSession(
					row.session,
					commanderMap.get(row.session.id) ?? null,
					[],
					this.getEffectiveSessionStatus({
						status: row.session.status,
						endedAt: row.session.endedAt,
					})
				)
			),
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
			.select({
				session: fleetTrackingSessions,
			})
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, sessionId))
			.limit(1)
		if (!row) return null

		const commanderCharacterIds = row.session.fleetId
			? Array.from((await this.getLatestCommanderBySessionIds([row.session.id])).values())
			: []
		const effectiveStatus = this.getEffectiveSessionStatus({
			status: row.session.status,
			endedAt: row.session.endedAt,
		})

		return this.serializeSession(
			row.session,
			commanderCharacterIds[0] ?? null,
			commanderCharacterIds,
			effectiveStatus
		)
	}

	/**
	 * Get the currently active tracking session for a fleet, if one exists.
	 */
	async getActiveTrackingSessionByFleetId(fleetId: string): Promise<TrackingSession | null> {
		const [row] = await this.db
			.select({
				session: fleetTrackingSessions,
			})
			.from(fleetTrackingSessions)
			.where(
				and(
					eq(fleetTrackingSessions.fleetId, fleetId),
					eq(fleetTrackingSessions.status, 'active'),
					isNull(fleetTrackingSessions.endedAt)
				)
			)
			.orderBy(desc(fleetTrackingSessions.startedAt))
			.limit(1)
		if (!row) return null

		const commanderCharacterIds = Array.from(
			(await this.getLatestCommanderBySessionIds([row.session.id])).values()
		)
		const effectiveStatus = this.getEffectiveSessionStatus({
			status: row.session.status,
			endedAt: row.session.endedAt,
		})

		return this.serializeSession(
			row.session,
			commanderCharacterIds[0] ?? null,
			commanderCharacterIds,
			effectiveStatus
		)
	}

	/**
	 * Get the most recent tracking session for a fleet, regardless of status.
	 */
	async getLatestTrackingSessionByFleetId(fleetId: string): Promise<TrackingSession | null> {
		const [row] = await this.db
			.select({
				session: fleetTrackingSessions,
			})
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.fleetId, fleetId))
			.orderBy(desc(fleetTrackingSessions.startedAt))
			.limit(1)
		if (!row) return null

		const commanderCharacterIds = Array.from(
			(await this.getLatestCommanderBySessionIds([row.session.id])).values()
		)
		const effectiveStatus = this.getEffectiveSessionStatus({
			status: row.session.status,
			endedAt: row.session.endedAt,
		})

		return this.serializeSession(
			row.session,
			commanderCharacterIds[0] ?? null,
			commanderCharacterIds,
			effectiveStatus
		)
	}

	/**
	 * Get the live snapshot from the FleetMonitor DO for an active session's fleet.
	 * Returns a status envelope so callers can distinguish a ready snapshot
	 * from an inactive session or a monitor read failure.
	 */
	async getSessionLiveSnapshot(sessionId: string): Promise<SessionLiveSnapshotResult> {
		const [session] = await this.db
			.select({
				fleetId: fleetTrackingSessions.fleetId,
				status: fleetTrackingSessions.status,
				endedAt: fleetTrackingSessions.endedAt,
			})
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, sessionId))
			.limit(1)
		if (!session || !session.fleetId) {
			return {
				state: 'inactive',
				message: 'This fleet tracking session is no longer active.',
				snapshot: null,
			}
		}
		if (
			this.getEffectiveSessionStatus({ status: session.status, endedAt: session.endedAt }) !==
			'active'
		) {
			return {
				state: 'inactive',
				message: 'This fleet tracking session is no longer active.',
				snapshot: null,
			}
		}
		try {
			const monitorStub = getStub<FleetMonitor>(this.env.FLEET_MONITOR, `fleet-${session.fleetId}`)
			const [status, monitorState] = await Promise.all([
				monitorStub.getFleetStatus(),
				monitorStub.getMonitorState(),
			])
			if (!status) {
				return {
					state: 'unavailable',
					message:
						'The latest live fleet snapshot could not be read. The fleet may have ended or the monitor may still be recovering.',
					snapshot: null,
				}
			}
			if (monitorState?.notFound) {
				return {
					state: 'unavailable',
					message:
						'The tracked fleet could not be found, so the latest live snapshot is unavailable.',
					snapshot: null,
				}
			}

			const peakMemberCount = Math.max(monitorState?.peakMemberCount ?? 0, status.memberCount)
			const lastChecked = monitorState?.lastChecked ?? new Date().toISOString()

			return {
				state: 'ready',
				message: null,
				snapshot: {
					fleetId: session.fleetId,
					memberCount: status.memberCount,
					peakMemberCount,
					motd: status.fleetInfo.motd || null,
					isFreeMove: status.fleetInfo.is_free_move,
					isRegistered: status.fleetInfo.is_registered,
					isVoiceEnabled: status.fleetInfo.is_voice_enabled,
					lastChecked,
					updatedAt: lastChecked,
				},
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (
				message.includes('ESI request failed: 404') ||
				message.includes('404 Not Found') ||
				message.includes('not found')
			) {
				logger.warn('[FleetsDO] Live snapshot unavailable because fleet no longer exists', {
					sessionId,
					fleetId: session.fleetId,
					error: message,
				})
				return {
					state: 'unavailable',
					message:
						'The latest live fleet snapshot could not be read. The fleet may have ended or the monitor may still be recovering.',
					snapshot: null,
				}
			}

			logger.warn('[FleetsDO] Failed to read live snapshot from FleetMonitor', {
				sessionId,
				fleetId: session.fleetId,
				error: message,
			})
			return {
				state: 'unavailable',
				message:
					'The latest live fleet snapshot could not be read. The fleet may have ended or the monitor may still be recovering.',
				snapshot: null,
			}
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
		const wantHistEvents =
			!args.eventType || args.eventType === 'join' || args.eventType === 'leave'
		if (args.eventType === 'join' || args.eventType === 'leave') {
			histConditions.push(eq(fleetMemberHistory.eventType, args.eventType))
		}

		const historyRows = wantHistEvents
			? await this.db
					.select()
					.from(fleetMemberHistory)
					.where(and(...histConditions))
			: []

		// --- 1.25) Lifecycle rows from fleet_tracking_session_events ---
		const wantLifecycleEvents = !args.eventType
		const lifecycleWhere = args.characterId
			? and(
					eq(fleetTrackingSessionEvents.trackingSessionId, args.sessionId),
					or(
						eq(fleetTrackingSessionEvents.characterId, args.characterId),
						eq(fleetTrackingSessionEvents.previousCharacterId, args.characterId)
					)
				)!
			: eq(fleetTrackingSessionEvents.trackingSessionId, args.sessionId)
		const lifecycleRows = wantLifecycleEvents
			? await this.db
					.select({
						id: fleetTrackingSessionEvents.id,
						trackingSessionId: fleetTrackingSessionEvents.trackingSessionId,
						previousCharacterId: fleetTrackingSessionEvents.previousCharacterId,
						characterId: fleetTrackingSessionEvents.characterId,
						eventType: fleetTrackingSessionEvents.eventType,
						observedAt: fleetTrackingSessionEvents.observedAt,
					})
					.from(fleetTrackingSessionEvents)
					.where(lifecycleWhere)
					.orderBy(asc(fleetTrackingSessionEvents.observedAt))
			: []

		// --- 1.5) Fleet-boss handoff rows from fleet_commander_events ---
		// These are merged into the same timeline stream so callers see one
		// contiguous session history.
		const wantBossChanges = !args.eventType
		const bossWhere = args.characterId
			? and(
					eq(fleetCommanderEvents.trackingSessionId, args.sessionId),
					or(
						eq(fleetCommanderEvents.previousCommanderCharacterId, args.characterId),
						eq(fleetCommanderEvents.commanderCharacterId, args.characterId)
					)
				)!
			: eq(fleetCommanderEvents.trackingSessionId, args.sessionId)
		const bossChangeRows = wantBossChanges
			? await this.db
					.select()
					.from(fleetCommanderEvents)
					.where(bossWhere)
					.orderBy(asc(fleetCommanderEvents.observedAt))
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

		const bossChangeItems: SessionTimelineRow[] = bossChangeRows.map((row) => ({
			id: `boss-${row.id}`,
			characterId: row.commanderCharacterId,
			eventType:
				row.eventType === 'initial'
					? ('fleet_boss_initial' as const)
					: ('fleet_boss_change' as const),
			shipTypeId: 0,
			shipTypeName: null,
			previousShipTypeId: null,
			previousShipTypeName: null,
			solarSystemId: 0,
			systemName: null,
			stationId: null,
			role: '',
			roleName: '',
			characterName: null,
			previousFleetBossCharacterId: row.previousCommanderCharacterId,
			previousFleetBossCharacterName: null,
			eventTimestamp: row.observedAt.toISOString(),
		}))

		const lifecycleItems: SessionTimelineRow[] = lifecycleRows.map((row) => ({
			id: `lifecycle-${row.id}`,
			characterId: row.characterId,
			eventType:
				row.eventType === 'started'
					? ('tracking_started' as const)
					: row.eventType === 'resumed'
						? ('tracking_resumed' as const)
						: ('tracking_ended' as const),
			shipTypeId: 0,
			shipTypeName: null,
			previousShipTypeId: null,
			previousShipTypeName: null,
			solarSystemId: 0,
			systemName: null,
			stationId: null,
			role: '',
			roleName: '',
			characterName: null,
			previousFleetBossCharacterId: row.previousCharacterId,
			previousFleetBossCharacterName: null,
			eventTimestamp: row.observedAt.toISOString(),
		}))

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
		const merged = [
			...historyItems,
			...lifecycleItems,
			...bossChangeItems,
			...shipChangeItems,
		].sort((a, b) => b.eventTimestamp.localeCompare(a.eventTimestamp))
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
	 * Get commander handoff events for a session.
	 */
	async getSessionCommanderHistory(sessionId: string): Promise<SessionCommanderEvent[]> {
		const rows = await this.db
			.select()
			.from(fleetCommanderEvents)
			.where(eq(fleetCommanderEvents.trackingSessionId, sessionId))
			.orderBy(asc(fleetCommanderEvents.observedAt))

		return rows.map((row) => ({
			id: row.id,
			fleetId: row.fleetId,
			trackingSessionId: row.trackingSessionId,
			previousCommanderCharacterId: row.previousCommanderCharacterId,
			commanderCharacterId: row.commanderCharacterId,
			eventType: row.eventType as SessionCommanderEvent['eventType'],
			observedAt: row.observedAt.toISOString(),
		}))
	}

	private async getFleetBossAttributionBySession(
		range: StatsRange
	): Promise<Map<string, Map<string, { minutes: number; hasActiveTime: boolean }>>> {
		const from = new Date(range.from)
		const to = new Date(range.to)

		const sessions = await this.db
			.select({
				id: fleetTrackingSessions.id,
				characterId: fleetTrackingSessions.characterId,
				startedAt: fleetTrackingSessions.startedAt,
				endedAt: fleetTrackingSessions.endedAt,
			})
			.from(fleetTrackingSessions)
			.where(
				and(
					lt(fleetTrackingSessions.startedAt, to),
					or(
						and(eq(fleetTrackingSessions.status, 'active'), isNull(fleetTrackingSessions.endedAt)),
						and(isNotNull(fleetTrackingSessions.endedAt), gt(fleetTrackingSessions.endedAt, from))
					)
				)
			)

		if (sessions.length === 0) {
			return new Map()
		}

		const sessionIds = sessions.map((session) => session.id)
		const lifecycleRows = await this.db
			.select({
				trackingSessionId: fleetTrackingSessionEvents.trackingSessionId,
				characterId: fleetTrackingSessionEvents.characterId,
				eventType: fleetTrackingSessionEvents.eventType,
				observedAt: fleetTrackingSessionEvents.observedAt,
			})
			.from(fleetTrackingSessionEvents)
			.where(inArray(fleetTrackingSessionEvents.trackingSessionId, sessionIds))
			.orderBy(asc(fleetTrackingSessionEvents.observedAt))

		const bossRows = await this.db
			.select({
				trackingSessionId: fleetCommanderEvents.trackingSessionId,
				commanderCharacterId: fleetCommanderEvents.commanderCharacterId,
				observedAt: fleetCommanderEvents.observedAt,
			})
			.from(fleetCommanderEvents)
			.where(
				and(
					inArray(fleetCommanderEvents.trackingSessionId, sessionIds),
					lt(fleetCommanderEvents.observedAt, to)
				)
			)
			.orderBy(asc(fleetCommanderEvents.observedAt))

		const lifecycleBySession = new Map<
			string,
			Array<{ characterId: string; eventType: 'started' | 'ended' | 'resumed'; observedAt: Date }>
		>()
		for (const row of lifecycleRows) {
			if (!row.trackingSessionId) continue
			const list = lifecycleBySession.get(row.trackingSessionId) ?? []
			list.push({
				characterId: row.characterId,
				eventType: row.eventType as 'started' | 'ended' | 'resumed',
				observedAt: row.observedAt,
			})
			lifecycleBySession.set(row.trackingSessionId, list)
		}

		const bossBySession = new Map<
			string,
			Array<{ commanderCharacterId: string; observedAt: Date }>
		>()
		for (const row of bossRows) {
			if (!row.trackingSessionId) continue
			const list = bossBySession.get(row.trackingSessionId) ?? []
			list.push({
				commanderCharacterId: row.commanderCharacterId,
				observedAt: row.observedAt,
			})
			bossBySession.set(row.trackingSessionId, list)
		}

		const bySession = new Map<string, Map<string, { minutes: number; hasActiveTime: boolean }>>()
		const addMinutes = (
			sessionMap: Map<string, { minutes: number; hasActiveTime: boolean }>,
			characterId: string,
			deltaMs: number
		): void => {
			if (deltaMs <= 0) return
			const deltaMinutes = deltaMs / 60_000
			const existing = sessionMap.get(characterId) ?? { minutes: 0, hasActiveTime: false }
			existing.minutes += deltaMinutes
			existing.hasActiveTime = true
			sessionMap.set(characterId, existing)
		}

		for (const session of sessions) {
			const sessionMap = new Map<string, { minutes: number; hasActiveTime: boolean }>()
			const timeline: Array<
				| { kind: 'lifecycle'; eventType: 'started' | 'ended' | 'resumed'; observedAt: Date }
				| { kind: 'boss'; commanderCharacterId: string; observedAt: Date }
			> = []

			for (const row of lifecycleBySession.get(session.id) ?? []) {
				timeline.push({
					kind: 'lifecycle',
					eventType: row.eventType,
					observedAt: row.observedAt,
				})
			}
			for (const row of bossBySession.get(session.id) ?? []) {
				timeline.push({
					kind: 'boss',
					commanderCharacterId: row.commanderCharacterId,
					observedAt: row.observedAt,
				})
			}

			timeline.sort((a, b) => {
				const diff = a.observedAt.getTime() - b.observedAt.getTime()
				if (diff !== 0) return diff
				if (a.kind === b.kind) return 0
				return a.kind === 'lifecycle' ? -1 : 1
			})

			let active = true
			let currentBossId = session.characterId
			let cursor = session.startedAt.getTime()
			const windowStart = from.getTime()
			const windowEnd = Math.min(session.endedAt?.getTime() ?? to.getTime(), to.getTime())

			for (const event of timeline) {
				const eventTime = Math.max(event.observedAt.getTime(), session.startedAt.getTime())
				if (eventTime > windowEnd) break

				if (active && eventTime > windowStart) {
					addMinutes(sessionMap, currentBossId, eventTime - Math.max(cursor, windowStart))
				}

				cursor = eventTime
				if (event.kind === 'lifecycle') {
					active = event.eventType !== 'ended'
				} else {
					currentBossId = event.commanderCharacterId
				}
			}

			if (active && windowEnd > windowStart) {
				addMinutes(sessionMap, currentBossId, windowEnd - Math.max(cursor, windowStart))
			}

			bySession.set(session.id, sessionMap)
		}

		return bySession
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

	/** Minimal read projection for SRP staff tooling. */
	async getSrpFleetSessionDetails(sessionId: string): Promise<SrpFleetSessionDetails | null> {
		const session = await this.getTrackingSession(sessionId)
		if (!session) return null

		const [commanderEvents, summary, liveSnapshot] = await Promise.all([
			this.getSessionCommanderHistory(sessionId),
			session.status === 'ended'
				? this.getSessionSummary(sessionId).catch(() => null)
				: Promise.resolve(null),
			session.status === 'active'
				? this.getSessionLiveSnapshot(sessionId).catch(() => null)
				: Promise.resolve(null),
		])

		const commanderCharacterIds = Array.from(
			new Set(
				[
					session.characterId,
					...commanderEvents.flatMap((event) => [
						event.previousCommanderCharacterId,
						event.commanderCharacterId,
					]),
				].filter((id): id is string => Boolean(id))
			)
		)
		let commanderCharacterNames: Record<string, string> = {}
		try {
			const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			commanderCharacterNames = await tokenStore.resolveIds(commanderCharacterIds)
		} catch (error) {
			logger.warn('[FleetsDO] Failed to resolve SRP commander names', {
				sessionId,
				error: error instanceof Error ? error.message : String(error),
			})
		}

		return {
			sessionId: session.id,
			sessionName: session.name,
			fleetId: session.fleetId,
			status: session.status,
			startedAt: session.startedAt,
			endedAt: session.endedAt,
			commanderCharacterIds,
			commanderCharacterNames,
			motd: summary?.motd ?? liveSnapshot?.snapshot?.motd ?? null,
		}
	}

	async wasSessionMemberAt(
		sessionId: string,
		characterId: string,
		occurredAt: string
	): Promise<boolean> {
		const occurred = parseDateOrNull(occurredAt)
		if (!occurred) return false

		const [session] = await this.db
			.select({
				fleetId: fleetTrackingSessions.fleetId,
				startedAt: fleetTrackingSessions.startedAt,
				endedAt: fleetTrackingSessions.endedAt,
			})
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, sessionId))
			.limit(1)
		if (!session || !session.fleetId) return false
		if (occurred < session.startedAt || (session.endedAt && occurred > session.endedAt))
			return false

		const [membership] = await this.db
			.select({ id: fleetMemberShipEvents.id })
			.from(fleetMemberShipEvents)
			.where(
				and(
					eq(fleetMemberShipEvents.trackingSessionId, sessionId),
					eq(fleetMemberShipEvents.characterId, characterId),
					lte(fleetMemberShipEvents.startedAt, occurred),
					or(isNull(fleetMemberShipEvents.endedAt), gte(fleetMemberShipEvents.endedAt, occurred))
				)
			)
			.limit(1)
		return Boolean(membership)
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
	 * Get the live location overlay for a session's current members.
	 *
	 * This reads the FleetMonitor's live ESI snapshot and returns the current
	 * solar system / station for each active fleet member without mutating the
	 * historical ship-event rows.
	 */
	async getSessionLiveMemberLocations(sessionId: string): Promise<SessionLiveMemberLocation[]> {
		const [session] = await this.db
			.select({
				fleetId: fleetTrackingSessions.fleetId,
				status: fleetTrackingSessions.status,
				endedAt: fleetTrackingSessions.endedAt,
			})
			.from(fleetTrackingSessions)
			.where(eq(fleetTrackingSessions.id, sessionId))
			.limit(1)

		const effectiveStatus = session
			? this.getEffectiveSessionStatus({
					status: session.status,
					endedAt: session.endedAt,
				})
			: 'ended'

		if (!session?.fleetId || effectiveStatus !== 'active') {
			return []
		}

		try {
			const monitorStub = getStub<FleetMonitor>(this.env.FLEET_MONITOR, `fleet-${session.fleetId}`)
			const status = await monitorStub.getFleetStatus()
			if (!status?.members?.length) {
				return []
			}

			const systemNames = (status as { systemNames?: Record<string, string> }).systemNames ?? {}
			const stationNames = (status as { stationNames?: Record<string, string> }).stationNames ?? {}
			const updatedAt = new Date().toISOString()

			return status.members.map((member) => ({
				characterId: String(member.character_id),
				solarSystemId: member.solar_system_id,
				systemName: systemNames[String(member.solar_system_id)] ?? null,
				stationId: member.station_id ?? null,
				stationName:
					member.station_id !== null && member.station_id !== undefined
						? (stationNames[String(member.station_id)] ?? null)
						: null,
				updatedAt,
			}))
		} catch (error) {
			logger.warn('[FleetsDO] Failed to read live member locations from monitor', {
				sessionId,
				fleetId: session.fleetId,
				error: error instanceof Error ? error.message : String(error),
			})
			return []
		}
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
				const segEnd = seg.endedAt ? seg.endedAt.getTime() : (sessionEndedMs ?? now.getTime())
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
				endedAt: fleetTrackingSessions.endedAt,
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
		const effectiveStatus = this.getEffectiveSessionStatus({
			status: session.status,
			endedAt: session.endedAt,
		})
		if (effectiveStatus !== 'active') {
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
					buildError: ({ response, body }) => new Error(this.formatFleetKickError(response, body)),
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
			.where(and(gte(fleetSummaries.startedAt, from), lt(fleetSummaries.startedAt, to)))

		// Active (still running) sessions started in the window — include their
		// session count but their durations aren't in fleet_summaries yet.
		const activeSessions = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(fleetTrackingSessions)
			.where(
				and(
					eq(fleetTrackingSessions.status, 'active'),
					isNull(fleetTrackingSessions.endedAt),
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
				and(gte(fleetMemberHistory.eventTimestamp, from), lt(fleetMemberHistory.eventTimestamp, to))
			)

		const bossAttributionBySession = await this.getFleetBossAttributionBySession(range)
		const topFCMap = new Map<string, { characterId: string; count: number; minutesAsFC: number }>()
		for (const session of bossAttributionBySession.values()) {
			for (const [characterId, stats] of session.entries()) {
				const entry = topFCMap.get(characterId) ?? {
					characterId,
					count: 0,
					minutesAsFC: 0,
				}
				if (stats.hasActiveTime) {
					entry.count += 1
				}
				entry.minutesAsFC += stats.minutes
				topFCMap.set(characterId, entry)
			}
		}
		const topFCs = Array.from(topFCMap.values())
			.sort((a, b) => b.minutesAsFC - a.minutesAsFC)
			.slice(0, 10)

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
			.orderBy(
				desc(
					sql`sum(extract(epoch from least(coalesce(${fleetMemberShipEvents.endedAt}, ${to.toISOString()}::timestamp), ${to.toISOString()}::timestamp) - greatest(${fleetMemberShipEvents.startedAt}, ${from.toISOString()}::timestamp)))`
				)
			)
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
				and(gte(fleetTrackingSessions.startedAt, from), lt(fleetTrackingSessions.startedAt, to))
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
			topFCs: topFCs.map((r) => ({
				characterId: r.characterId,
				count: r.count,
				minutesAsFC: Math.round(r.minutesAsFC),
			})),
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
					minutesAsFC: 0,
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
		const bossAttributionBySession = await this.getFleetBossAttributionBySession(range)

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
						minutesAsFC: 0,
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
		const bossAggregates = new Map<string, { minutesAsFC: number; sessionIds: Set<string> }>()
		for (const [sessionId, sessionMap] of bossAttributionBySession.entries()) {
			for (const [bossCharacterId, stats] of sessionMap.entries()) {
				if (!stats.hasActiveTime) continue
				const entry = bossAggregates.get(bossCharacterId) ?? {
					minutesAsFC: 0,
					sessionIds: new Set<string>(),
				}
				entry.minutesAsFC += stats.minutes
				entry.sessionIds.add(sessionId)
				bossAggregates.set(bossCharacterId, entry)
			}
		}

		for (const [characterId, stats] of bossAggregates.entries()) {
			ensure(characterId).totals.timesFC = stats.sessionIds.size
			ensure(characterId).totals.minutesAsFC = Math.round(stats.minutesAsFC)
		}
		for (const row of shipRows) {
			ensure(row.characterId).shipsFlown.push({
				shipTypeId: row.shipTypeId,
				totalMinutes: row.totalMinutes ?? 0,
			})
		}
		for (const row of recentRows) {
			const bossMinutes = row.sessionId
				? (bossAttributionBySession.get(row.sessionId)?.get(row.characterId)?.minutes ?? 0)
				: 0
			const recent: CharacterRecentSessionRow = {
				sessionId: row.sessionId,
				sessionName: row.sessionName,
				fleetId: row.fleetId,
				wasFC: bossMinutes > 0,
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
	async getCharactersByCorpInWindow(corporationId: string, range: StatsRange): Promise<string[]> {
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
		row: typeof fleetTrackingSessions.$inferSelect,
		currentFleetBossCharacterId: string | null,
		fleetBossCharacterIds: string[] = [],
		effectiveStatus?: TrackingSession['status']
	): TrackingSession => ({
		id: row.id,
		name: row.name,
		characterId: row.characterId,
		currentFleetBossCharacterId,
		currentFleetBossCharacterName: null,
		fleetBossCharacterIds,
		currentCommanderCharacterId: currentFleetBossCharacterId,
		currentCommanderCharacterName: null,
		commanderCharacterIds: fleetBossCharacterIds,
		startedByUserId: row.startedByUserId,
		fleetId: row.fleetId,
		status: effectiveStatus ?? (row.status as TrackingSession['status']),
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

			logger.log('WebSocket message received:', data)

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
			logger.error('Error processing WebSocket message:', error)
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
		logger.log('WebSocket closed:', { code, reason, wasClean })
		// Cleanup logic here
	}

	/**
	 * WebSocket error handler (Hibernation API)
	 * Called when a WebSocket error occurs
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		logger.error('WebSocket error:', error)
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
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

		return new Response('Fleets Durable Object', { status: 200 })
	}
}
