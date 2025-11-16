import { DurableObject } from 'cloudflare:workers'

import { and, createDbClient, eq, gt, lte } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { assertEveCharacterId } from '@repo/eve-types'
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
	QuickJoinCreationResult,
	QuickJoinInvitation,
	QuickJoinValidationResult,
} from '@repo/fleets'
import { logger } from '@repo/hono-helpers'

import { Env } from './context'
import {
	fleetInvitations,
	fleetMemberships,
	fleetStateCache,
	monitoredFleetCommanders,
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

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDbClient(this.env.DATABASE_URL, schema)
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
		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

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
		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

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
		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
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
		using characterStub = getStub<EveCharacterData>(
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

		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

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
		using characterStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, characterId)
		const characterInfo = await characterStub.getCharacterInfo(characterId)

		// Resolve ship type IDs, character IDs, system IDs, and station IDs to names if members are available
		let resolvedShipTypes: Record<string, string> | undefined
		let resolvedCharacterNames: Record<string, string> | undefined
		let resolvedSystemNames: Record<string, string> | undefined
		let resolvedStationNames: Record<string, string> | undefined
		if (members && members.length > 0) {
			try {
				// Resolve ship type IDs
				using universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
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
		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

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

			const response = await fetch(
				`https://esi.evetech.net/latest/fleets/${invitation.fleetId}/members/?datasource=tranquility`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${accessToken}`,
					},
					body: JSON.stringify({
						character_id: parseInt(joiningCharacterId),
						role: 'squad_member',
					}),
				}
			)

			if (!response.ok) {
				const errorText = await response.text()
				console.error('ESI fleet invite failed:', errorText)
				return {
					success: false,
					error: 'Failed to create fleet invitation',
				}
			}
		} catch (error) {
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
		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
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
		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
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

	/**
	 * List all monitored fleet commanders
	 * @returns Array of character IDs
	 */
	async listMonitoredFleetCommanders(): Promise<string[]> {
		const commanders = await this.db.select().from(monitoredFleetCommanders)
		return commanders.map((c) => c.characterId)
	}

	/**
	 * Add a fleet commander to the monitored list
	 * @param characterId - EVE character ID to monitor
	 * @returns true if added successfully, false if already exists
	 */
	async addMonitoredFleetCommander(characterId: string): Promise<boolean> {
		try {
			await this.db.insert(monitoredFleetCommanders).values({
				characterId,
			})
			return true
		} catch (error) {
			// Check if it's a unique constraint violation (already exists)
			if (error instanceof Error && error.message.includes('unique')) {
				return false
			}
			throw error
		}
	}

	/**
	 * Remove a fleet commander from the monitored list
	 * @param characterId - EVE character ID to remove
	 * @returns true if removed successfully, false if not found
	 */
	async removeMonitoredFleetCommander(characterId: string): Promise<boolean> {
		// Check if the record exists first
		const existing = await this.db
			.select()
			.from(monitoredFleetCommanders)
			.where(eq(monitoredFleetCommanders.characterId, characterId))
			.limit(1)

		if (existing.length === 0) {
			return false
		}

		// Delete the record
		await this.db
			.delete(monitoredFleetCommanders)
			.where(eq(monitoredFleetCommanders.characterId, characterId))

		return true
	}

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

			for (const fleet of activeFleets) {
				try {
					// Get the FleetMonitor DO stub for this fleet
					using fleetMonitorStub = getStub<FleetMonitor>(
						this.env.FLEET_MONITOR,
						`fleet-${fleet.fleetId}`
					)

					// Get the monitor's internal state
					const monitorState = await fleetMonitorStub.getMonitorState()

					if (!monitorState || !monitorState.isInitialized) {
						logger.warn('[FleetsDO Watchdog] FleetMonitor not initialized', {
							fleetId: fleet.fleetId,
						})
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
					staleFleets: staleFleets.map((f) => ({
						fleetId: f.fleetId,
						ageSeconds: Math.round(f.ageMs / 1000),
					})),
				})
			} else {
				logger.info('[FleetsDO Watchdog] All FleetMonitors are healthy', {
					totalChecked: activeFleets.length,
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
