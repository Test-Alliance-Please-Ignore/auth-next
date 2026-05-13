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
	): Promise<
		Array<{
			characterId: string
			characterName: string
			hasValidToken: boolean
			isDeleted: boolean
			corporationId?: string | null
			corporationName?: string | null
			allianceId?: string | null
			allianceName?: string | null
		}>
	>
	getUserCorporations(
		userId: string
	): Promise<Array<{ corporationId: string; corporationName: string }>>
	getUserCorporationsBatch(
		userIds: string[]
	): Promise<Map<string, Array<{ corporationId: string; corporationName: string }>>>
	getUserAlliances(userId: string): Promise<Array<{ allianceId: string; allianceName: string }>>
	getUserDiscordUserId(userId: string): Promise<string | null>
	listUsersNeedingRefresh(limit: number): Promise<string[]>
	addPendingDiscordRefreshes(
		userIds: string[],
		options?: { source?: string; force?: boolean }
	): Promise<{ pendingCount: number; added: number; skipped: number }>
	handleCharacterAffiliationChange(
		characterId: string,
		options?: { source?: string; bypassThrottle?: boolean }
	): Promise<{
		usersMatched: number
		workflowsTriggered: number
		discordUsersQueued: number
	}>
	handleCharacterAffiliationChanges(
		characterIds: string[],
		options?: { source?: string; bypassThrottle?: boolean }
	): Promise<{
		usersMatched: number
		workflowsTriggered: number
		discordUsersQueued: number
	}>
	processPendingDiscordRefreshes(): Promise<{
		processed: number
		triggered: number
		failed: number
	}>
	createUserBlacklist(input: {
		userId: string
		reason: string
		blacklistedBy: string
		metadata?: Record<string, unknown>
	}): Promise<{ entryId: string }>
	legacyImportCharacterLinks(input: {
		modernUserId: string
		legacyAuthUserId: string
		characters: Array<{ characterId: string; characterName: string; source?: 'legacy_primary' | 'esi_owner' | 'xml_account' }>
	}): Promise<{
		inserted: number
		alreadyLinkedToUser: number
		linkedToOtherUser: number
		totalRequested: number
	}>
	legacyImportNotes(input: {
		modernUserId: string
		legacyAuthUserId: string
		actorUserId: string
		notes: Array<{
			legacyNoteId: string
			note: string
			legacyCreatedByUserId?: string | null
			legacyDateCreated?: string | null
			metadata?: Record<string, unknown>
		}>
	}): Promise<{ created: number; failed: number; totalRequested: number }>
	legacyImportIpAssociations(input: {
		modernUserId: string
		legacyAuthUserId: string
		ipAddresses: Array<{
			ipAddress: string
			firstSeenAt?: string | null
			lastSeenAt?: string | null
		}>
	}): Promise<{ imported: number; failed: number; totalRequested: number }>
	getImportedLegacyNoteIdsForUser(
		userId: string,
		legacyNoteIds: string[]
	): Promise<string[]>
	evaluateLegacyMigrationBlacklistSignals(input: {
		modernUserId: string
		characterPairs: Array<{ characterId: string; characterName: string }>
		discordUserIds: string[]
		ipAddresses: string[]
		sourceHints?: Array<{
			targetType:
				| 'user'
				| 'character_id'
				| 'character_name'
				| 'discord_id'
				| 'corporation_id'
				| 'corporation_name'
				| 'alliance_id'
				| 'alliance_name'
			targetValue: string
			source: 'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'
		}>
	}): Promise<{
		hasAnyBlacklistSignal: boolean
		modernUserBlacklisted: boolean
		matchedTargets: Array<{
			targetType:
				| 'user'
				| 'character_id'
				| 'character_name'
				| 'discord_id'
				| 'corporation_id'
				| 'corporation_name'
				| 'alliance_id'
				| 'alliance_name'
			targetValue: string
			reason: string | null
			createdAt: Date | null
			blacklistedBy: string | null
			entryMode: 'manual' | 'automatic' | null
			discoverySources: Array<'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'>
			preferredSource: 'legacy' | 'tang'
		}>
		matchingCharactersBlacklisted: Array<{
			characterId: string
			characterName: string
			matchedBy: Array<'character_id' | 'character_name'>
			reason: string | null
			createdAt: Date | null
			blacklistedBy: string | null
			entryMode: 'manual' | 'automatic' | null
			discoverySources: Array<'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'>
			preferredSource: 'legacy' | 'tang'
		}>
		matchingDiscordUserIdsBlacklisted: string[]
		ipAssociatedBlacklistedUsers: Array<{
			userId: string
			mainCharacterId: string
			mainCharacterName: string | null
			matchingIpHashes: string[]
			userBlacklisted: boolean
			discordBlacklisted: boolean
			matchedItems: Array<{
				targetType:
					| 'user'
					| 'character_id'
					| 'character_name'
					| 'discord_id'
					| 'corporation_id'
					| 'corporation_name'
					| 'alliance_id'
					| 'alliance_name'
				targetValue: string
			}>
			matchingBlacklistedCharacters: Array<{
				characterId: string
				characterName: string
				matchedBy: Array<'character_id' | 'character_name'>
			}>
		}>
	}>
}

export * from './roles'
export * from './user'
