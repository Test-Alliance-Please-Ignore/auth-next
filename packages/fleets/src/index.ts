/**
 * @repo/fleets
 *
 * Shared types and interfaces for the Fleets Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import { EsiGetCharacterFleetInformation, EsiGetFleetInformation, EsiGetFleetMembers } from './esi'

import type { EveCharacterId } from '@repo/eve-types'

/**
 * Quick join invitation data structure
 */
export interface QuickJoinInvitation {
	id: string
	token: string
	fleetBossId: string
	fleetId: string
	expiresAt: Date
	maxUses?: number
	usesCount: number
	isActive: boolean
}

/**
 * Quick join creation result
 */
export interface QuickJoinCreationResult {
	token: string
	url: string
	expiresAt: Date
}

/**
 * Quick join validation result
 */
export interface QuickJoinValidationResult {
	valid: boolean
	invitation?: QuickJoinInvitation
	fleetInfo?: EsiGetFleetInformation
	fleetBossName?: string
	error?: string
}

/**
 * Character info for fleet join selection
 */
export interface CharacterForFleetJoin {
	characterId: string
	characterName: string
	portrait?: {
		px64x64: string
		px128x128: string
		px256x256: string
		px512x512: string
	}
	hasValidToken: boolean
	corporationId?: string
	corporationName?: string
}

/**
 * Fleet join result
 */
export interface FleetJoinResult {
	success: boolean
	error?: string
	invitationSent?: boolean
}

/**
 * Fleet details response
 */
export interface FleetDetailsResponse {
	fleetInfo: EsiGetFleetInformation
	members?: EsiGetFleetMembers
	fleetBossName?: string
	memberCount: number
}

/**
 * Public RPC interface for Fleets Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Fleets } from '@repo/fleets'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Fleets>(env.FLEETS, 'my-id')
 * const result = await stub.exampleMethod('hello')
 * ```
 */
/**
 * Fleet information with IDs converted to strings for consistency with the rest of the application
 */
export type FleetInformation = Omit<
	EsiGetCharacterFleetInformation,
	'fleet_id' | 'fleet_boss_id'
> & {
	fleet_id: string
	fleet_boss_id: string
}

export interface Fleets extends DurableObject {
	/**
	 * Get character's fleet information from ESI
	 * Returns with IDs as strings for consistency
	 */
	getCharacterFleetInformation(characterId: EveCharacterId): Promise<FleetInformation>

	/**
	 * Create a new quick join invitation for a fleet
	 * @param fleetBossId - Character ID of the fleet boss
	 * @param fleetId - ESI fleet ID
	 * @param expiresInHours - How many hours until expiry (default 24)
	 * @param maxUses - Optional maximum number of uses
	 */
	createQuickJoinInvitation(
		fleetBossId: string,
		fleetId: string,
		expiresInHours?: number,
		maxUses?: number
	): Promise<QuickJoinCreationResult>

	/**
	 * Validate a quick join token
	 * @param token - The quick join token to validate
	 */
	validateQuickJoinToken(token: string): Promise<QuickJoinValidationResult>

	/**
	 * Get detailed fleet information
	 * @param fleetId - ESI fleet ID
	 * @param characterId - Character ID to use for ESI access
	 */
	getFleetDetails(fleetId: string, characterId: string): Promise<FleetDetailsResponse>

	/**
	 * Join a fleet via quick join token
	 * @param token - Quick join token
	 * @param characterId - Character ID of the user initiating the join
	 * @param joiningCharacterId - Character ID to join the fleet
	 */
	joinFleetViaQuickJoin(
		token: string,
		characterId: string,
		joiningCharacterId: string
	): Promise<FleetJoinResult>

	/**
	 * Check if a fleet is still active
	 * @param fleetId - ESI fleet ID
	 * @param characterId - Character ID to use for ESI access
	 */
	isFleetActive(fleetId: string, characterId: string): Promise<boolean>

	/**
	 * Revoke a quick join invitation
	 * @param token - Token to revoke
	 * @param characterId - Character ID of the fleet boss
	 */
	revokeQuickJoinInvitation(token: string, characterId: string): Promise<boolean>
}

export * from './esi'
