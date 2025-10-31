import { DurableObject } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import { assertEveCharacterId } from '@repo/eve-types'
import {
	EsiGetCharacterFleetInformation,
	esiGetCharacterFleetInformationSchema,
	EsiGetFleetInformation,
	esiGetFleetInformationSchema,
	EsiGetFleetMembers,
	esiGetFleetMembersSchema,
	Fleets,
	FleetInformation,
	QuickJoinCreationResult,
	QuickJoinValidationResult,
	QuickJoinInvitation,
	FleetDetailsResponse,
	FleetJoinResult
} from '@repo/fleets'
import { createDbClient, eq, and, gt, lte } from '@repo/db-utils'

import { Env } from './context'
import { schema, fleetInvitations, fleetMemberships, fleetStateCache } from './db/schema'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { EveCharacterId } from '@repo/eve-types'

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
			.map(byte => chars[byte % chars.length])
			.join('')
	}

	async getCharacterFleetInformation(
		characterId: EveCharacterId
	): Promise<FleetInformation> {
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		console.log(`[Fleets DO] Getting fleet information for character ${characterId}`)

		try {
			// Fetch from ESI without schema (schemas can't be serialized across DO boundary)
			console.log(`[Fleets DO] Making ESI request to /characters/${characterId}/fleet/`)

			const response = await tokenStore.fetchEsi<EsiGetCharacterFleetInformation>(
				`/characters/${characterId}/fleet/`,
				characterId
			)

			// Validate the response locally using the schema
			const validatedData = esiGetCharacterFleetInformationSchema.parse(response.data)

			console.log(`[Fleets DO] ESI response received:`, {
				characterId,
				fleetId: validatedData.fleet_id,
				fleetBossId: validatedData.fleet_boss_id,
				role: validatedData.role,
				squadId: validatedData.squad_id,
				wingId: validatedData.wing_id
			})

			// Ensure IDs are returned as strings for consistency
			return {
				fleet_id: String(validatedData.fleet_id),
				fleet_boss_id: String(validatedData.fleet_boss_id),
				role: validatedData.role,
				squad_id: validatedData.squad_id,
				wing_id: validatedData.wing_id
			} as FleetInformation
		} catch (error) {
			// Safely extract error information without serializing complex objects
			const errorMessage = error instanceof Error ? error.message : String(error)
			const errorName = error instanceof Error ? error.constructor.name : typeof error

			console.error(`[Fleets DO] Error fetching fleet information for character ${characterId}:`)
			console.error(`[Fleets DO] Error message: ${errorMessage}`)
			console.error(`[Fleets DO] Error type: ${errorName}`)

			// Check if it's a specific ESI error or HTTP response error
			if (error instanceof Error) {
				// Check for specific error patterns in the message
				if (error.message.includes('404') || error.message.includes('Not found') || error.message.includes('Not Found')) {
					console.log(`[Fleets DO] Character ${characterId} is not in a fleet (404 response)`)
				} else if (error.message.includes('403') || error.message.includes('Forbidden')) {
					console.log(`[Fleets DO] Forbidden error - character ${characterId} may not have fleet scope`)
				} else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
					console.log(`[Fleets DO] Unauthorized - token may be expired for character ${characterId}`)
				} else if (error.message.includes('400') || error.message.includes('Bad Request')) {
					console.log(`[Fleets DO] Bad request - invalid parameters for character ${characterId}`)
				} else {
					// Log first 500 chars of stack trace if available
					if (error.stack) {
						console.error(`[Fleets DO] Stack trace (first 500 chars): ${error.stack.substring(0, 500)}`)
					}
				}
			}

			// Return default if character is not in a fleet or error occurs
			// Return IDs as strings for consistency
			return {
				fleet_boss_id: '0',
				fleet_id: '0',
				role: 'fleet_commander',
				squad_id: 0,
				wing_id: 0,
			} as FleetInformation
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
		const [invitation] = await this.db.insert(fleetInvitations).values({
			token,
			fleetBossId,
			fleetId,
			expiresAt,
			maxUses: maxUses || null,
			usesCount: 0,
			isActive: true
		}).returning()

		// Update fleet cache
		await this.db.insert(fleetStateCache).values({
			fleetId,
			fleetBossId,
			isActive: true,
			memberCount: 0,
			motd: fleetData.motd || null,
			isFreeMove: fleetData.is_free_move,
			isRegistered: fleetData.is_registered,
			isVoiceEnabled: fleetData.is_voice_enabled,
		}).onConflictDoUpdate({
			target: fleetStateCache.fleetId,
			set: {
				fleetBossId,
				isActive: true,
				motd: fleetData.motd || null,
				isFreeMove: fleetData.is_free_move,
				isRegistered: fleetData.is_registered,
				isVoiceEnabled: fleetData.is_voice_enabled,
				lastChecked: new Date(),
				updatedAt: new Date()
			}
		})

		return {
			token,
			url: `https://pleaseignore.app/fleets/join/${token}`,
			expiresAt
		}
	}

	async validateQuickJoinToken(token: string): Promise<QuickJoinValidationResult> {
		// Fetch invitation from database
		const [invitation] = await this.db.select()
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
				error: 'Invalid or expired invitation token'
			}
		}

		// Check if max uses exceeded
		if (invitation.maxUses && invitation.usesCount >= invitation.maxUses) {
			return {
				valid: false,
				error: 'This invitation has reached its maximum uses'
			}
		}

		// Verify fleet is still active
		const isActive = await this.isFleetActive(invitation.fleetId, invitation.fleetBossId)

		if (!isActive) {
			// Mark invitation as inactive
			await this.db.update(fleetInvitations)
				.set({ isActive: false })
				.where(eq(fleetInvitations.id, invitation.id))

			return {
				valid: false,
				error: 'The fleet is no longer active'
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
				isActive: invitation.isActive
			},
			fleetInfo,
			fleetBossName: characterInfo?.name
		}
	}

	async getFleetDetails(fleetId: string, characterId: string): Promise<FleetDetailsResponse> {
		// Check if fleet is marked as not found in cache
		const [cached] = await this.db.select()
			.from(fleetStateCache)
			.where(eq(fleetStateCache.fleetId, fleetId))
			.limit(1)

		if (cached?.notFound && cached.notFoundAt) {
			const notFoundAge = Date.now() - cached.notFoundAt.getTime()
			const twentyFourHours = 24 * 60 * 60 * 1000
			if (notFoundAge < twentyFourHours) {
				console.log(`[Fleet ${fleetId}] Marked as 404, skipping ESI query (age: ${Math.round(notFoundAge / 1000 / 60)} minutes)`)
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

			// Clear notFound flag if fleet is now found
			if (cached?.notFound) {
				await this.db.update(fleetStateCache)
					.set({
						notFound: false,
						notFoundAt: null,
						lastChecked: new Date(),
						updatedAt: new Date()
					})
					.where(eq(fleetStateCache.fleetId, fleetId))
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			// Check if it's a 404 error
			if (errorMessage.includes('404') || errorMessage.includes('Not found') || errorMessage.includes('Not Found')) {
				console.log(`[Fleet ${fleetId}] Received 404 from ESI, marking as not found`)

				// Mark fleet as not found
				await this.db.insert(fleetStateCache).values({
					fleetId,
					fleetBossId: characterId,
					isActive: false,
					memberCount: 0,
					notFound: true,
					notFoundAt: new Date(),
					lastChecked: new Date()
				}).onConflictDoUpdate({
					target: fleetStateCache.fleetId,
					set: {
						notFound: true,
						notFoundAt: new Date(),
						isActive: false,
						lastChecked: new Date(),
						updatedAt: new Date()
					}
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
			console.log('[Fleet Members] Raw ESI response sample (first member):', JSON.stringify(membersResponse.data[0], null, 2))
			console.log('[Fleet Members] First member station_id type:', typeof membersResponse.data[0]?.station_id)
			console.log('[Fleet Members] First member station_id value:', membersResponse.data[0]?.station_id)

			members = esiGetFleetMembersSchema.parse(membersResponse.data)
			memberCount = members.length
		} catch (error) {
			// Members fetch failed, but continue
			console.error('[Fleet Members] Failed to parse or fetch:', error)
			members = undefined
		}

		// Get fleet boss name
		const characterStub = getStub<EveCharacterData>(
			this.env.EVE_CHARACTER_DATA,
			characterId
		)
		const characterInfo = await characterStub.getCharacterInfo(characterId)

		return {
			fleetInfo,
			members,
			fleetBossName: characterInfo?.name,
			memberCount
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
				error: validation.error || 'Invalid token'
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
			console.log('[Fleet Join] Raw ESI response sample (first member):', JSON.stringify(membersResponse.data[0], null, 2))
			console.log('[Fleet Join] First member station_id type:', typeof membersResponse.data[0]?.station_id)
			console.log('[Fleet Join] First member station_id value:', membersResponse.data[0]?.station_id)

			const members = esiGetFleetMembersSchema.parse(membersResponse.data)

			const isAlreadyMember = members.some(
				(member: any) => member.character_id.toString() === joiningCharacterId
			)

			if (isAlreadyMember) {
				return {
					success: false,
					error: 'Character is already in the fleet'
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
					error: 'Fleet commander ESI access expired'
				}
			}

			const response = await fetch(
				`https://esi.evetech.net/latest/fleets/${invitation.fleetId}/members/?datasource=tranquility`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${accessToken}`
					},
					body: JSON.stringify({
						character_id: parseInt(joiningCharacterId),
						role: 'squad_member'
					})
				}
			)

			if (!response.ok) {
				const errorText = await response.text()
				console.error('ESI fleet invite failed:', errorText)
				return {
					success: false,
					error: 'Failed to create fleet invitation'
				}
			}
		} catch (error) {
			console.error('Failed to create fleet invitation:', error)
			return {
				success: false,
				error: 'Failed to create fleet invitation'
			}
		}

		// Update usage count
		await this.db.update(fleetInvitations)
			.set({ usesCount: invitation.usesCount + 1 })
			.where(eq(fleetInvitations.id, invitation.id))

		// Record membership
		await this.db.insert(fleetMemberships).values({
			characterId: joiningCharacterId,
			fleetId: invitation.fleetId,
			invitationId: invitation.id,
			role: 'squad_member'
		})

		return {
			success: true,
			invitationSent: true
		}
	}

	async isFleetActive(fleetId: string, characterId: string): Promise<boolean> {
		// Check cache first
		const [cached] = await this.db.select()
			.from(fleetStateCache)
			.where(
				and(
					eq(fleetStateCache.fleetId, fleetId),
					// Cache valid for 5 minutes
					gt(fleetStateCache.lastChecked, new Date(Date.now() - 5 * 60 * 1000))
				)
			)
			.limit(1)

		if (cached) {
			// If fleet was marked as not found within last 24 hours, don't query ESI again
			if (cached.notFound && cached.notFoundAt) {
				const notFoundAge = Date.now() - cached.notFoundAt.getTime()
				const twentyFourHours = 24 * 60 * 60 * 1000
				if (notFoundAge < twentyFourHours) {
					console.log(`[Fleet ${fleetId}] Marked as 404, skipping ESI query (age: ${Math.round(notFoundAge / 1000 / 60)} minutes)`)
					return false
				}
			}
			return cached.isActive
		}

		// Check with ESI
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		let isActive = false
		let isNotFound = false
		try {
			const fleetResponse = await tokenStore.fetchEsi<EsiGetFleetInformation>(
				`/fleets/${fleetId}/`,
				characterId
			)
			// Validate the response to ensure it's valid fleet data
			esiGetFleetInformationSchema.parse(fleetResponse.data)
			isActive = true
		} catch (error) {
			// Check if it's a 404 error
			const errorMessage = error instanceof Error ? error.message : String(error)
			if (errorMessage.includes('404') || errorMessage.includes('Not found') || errorMessage.includes('Not Found')) {
				console.log(`[Fleet ${fleetId}] Received 404 from ESI, marking as not found`)
				isNotFound = true
			}
			isActive = false
		}

		// Update cache
		await this.db.insert(fleetStateCache).values({
			fleetId,
			fleetBossId: characterId,
			isActive,
			memberCount: 0,
			notFound: isNotFound,
			notFoundAt: isNotFound ? new Date() : null,
			lastChecked: new Date()
		}).onConflictDoUpdate({
			target: fleetStateCache.fleetId,
			set: {
				isActive,
				notFound: isNotFound,
				notFoundAt: isNotFound ? new Date() : null,
				lastChecked: new Date(),
				updatedAt: new Date()
			}
		})

		return isActive
	}

	async revokeQuickJoinInvitation(token: string, characterId: string): Promise<boolean> {
		// Verify ownership
		const [invitation] = await this.db.select()
			.from(fleetInvitations)
			.where(
				and(
					eq(fleetInvitations.token, token),
					eq(fleetInvitations.fleetBossId, characterId)
				)
			)
			.limit(1)

		if (!invitation) {
			return false
		}

		// Mark as inactive
		await this.db.update(fleetInvitations)
			.set({ isActive: false })
			.where(eq(fleetInvitations.id, invitation.id))

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
	 * Alarm handler
	 * Called when a scheduled alarm triggers
	 */
	async alarm(): Promise<void> {
		console.log('FleetsDO alarm triggered at:', new Date().toISOString())
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

		return new Response('Fleets Durable Object', { status: 200 })
	}
}
