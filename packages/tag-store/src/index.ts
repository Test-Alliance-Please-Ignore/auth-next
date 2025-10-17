/**
 * TagStore Durable Object Interface
 *
 * This package provides TypeScript interfaces for the TagStore Durable Object
 * which manages user tags based on EVE Online corporation/alliance membership.
 *
 * The actual implementation lives in apps/tags/src/tag-store.ts
 */

// ========== Types ==========

export interface Tag {
	tagUrn: string
	tagType: 'corporation' | 'alliance'
	displayName: string
	eveId: number
	metadata: Record<string, unknown> | null
	color: string // 'green' for corporation, 'blue' for alliance
	createdAt: number
	updatedAt: number
}

export interface UserTag {
	assignmentId: string
	socialUserId: string
	tagUrn: string
	sourceCharacterId: number
	assignedAt: number
	lastVerifiedAt: number
}

export interface TagWithSources extends Tag {
	sourceCharacters: number[]
}

// ========== Durable Object Interface ==========

/**
 * TagStore Durable Object Interface
 *
 * Manages user tags based on EVE Online corporation and alliance membership.
 * Tags are automatically assigned and synced based on character data.
 *
 * Note: This interface is used for type-safe cross-worker communication.
 * The actual implementation is in apps/tags/src/tag-store.ts
 */
export interface TagStore {
	/**
	 * Create or update a tag
	 */
	upsertTag(
		urn: string,
		tagType: 'corporation' | 'alliance',
		displayName: string,
		eveId: number,
		metadata?: Record<string, unknown>
	): Promise<Tag>

	/**
	 * Get a tag by URN
	 * @returns Tag or null if not found
	 */
	getTag(urn: string): Promise<Tag | null>

	/**
	 * List all tags
	 */
	listAllTags(): Promise<Tag[]>

	/**
	 * Assign a tag to a user from a specific character
	 */
	assignTagToUser(userId: string, tagUrn: string, characterId: number): Promise<void>

	/**
	 * Remove a tag from a user
	 * @param characterId Optional: If provided, only remove the tag from this character source
	 */
	removeTagFromUser(userId: string, tagUrn: string, characterId?: number): Promise<void>

	/**
	 * Remove all tags sourced from a specific character
	 */
	removeAllTagsForCharacter(characterId: number): Promise<void>

	/**
	 * Get all unique tags for a user with their source characters
	 */
	getUserTags(userId: string): Promise<TagWithSources[]>

	/**
	 * Get all tag assignments for a user (includes duplicates from different characters)
	 */
	getUserTagAssignments(userId: string): Promise<UserTag[]>

	/**
	 * Get all users that have a specific tag
	 */
	getUsersWithTag(tagUrn: string): Promise<string[]>

	/**
	 * Schedule a user for tag evaluation
	 * @param delayMs Delay in milliseconds before evaluation (default: 1 hour)
	 */
	scheduleUserEvaluation(userId: string, delayMs?: number): Promise<void>

	/**
	 * Get users that need evaluation
	 * @param limit Maximum number of users to return
	 */
	getUsersNeedingEvaluation(limit: number): Promise<string[]>

	/**
	 * Evaluate and sync tags for a user based on their current characters
	 */
	evaluateUserTags(userId: string): Promise<void>
}
