/**
 * @repo/core
 *
 * Shared types and interfaces for the Core Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

export interface Core {
	getCharacterOwner(characterId: string): Promise<{ userId: string; isPrimary: boolean } | null>
	getUserCharacters(
		userId: string,
		includeDeleted?: boolean
	): Promise<Array<{ characterId: string; characterName: string; isDeleted: boolean }>>
	getUserCorporations(
		userId: string
	): Promise<Array<{ corporationId: string; corporationName: string }>>
	getUserCorporationsBatch(
		userIds: string[]
	): Promise<Map<string, Array<{ corporationId: string; corporationName: string }>>>
	getUserAlliances(userId: string): Promise<Array<{ allianceId: string; allianceName: string }>>
	getUserDiscordUserId(userId: string): Promise<string | null>
	listUsersNeedingRefresh(limit: number): Promise<string[]>
}

export * from './roles'
export * from './user'
