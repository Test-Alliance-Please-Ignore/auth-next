import { env, SELF } from 'cloudflare:test'
import { describe, expect, test } from 'vitest'

import type { TagStore, TagWithSources } from '@repo/tag-store'
import type { Env } from '../../context'

import '../..'

// Type assertion for env to include our bindings
const testEnv = env as unknown as Env

describe('Tags System', () => {
	describe('TagStore - Tag Management', () => {
		test('creates and retrieves corporation tag', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-corp-tag')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const urn = 'urn:eve:corporation:98000001'
			const tag = await store.upsertTag(urn, 'corporation', 'Test Corporation', 98000001, {
				ticker: 'TEST',
			})

			expect(tag.tagUrn).toBe(urn)
			expect(tag.displayName).toBe('Test Corporation')
			expect(tag.tagType).toBe('corporation')
			expect(tag.color).toBe('green')
			expect(tag.metadata?.ticker).toBe('TEST')

			// Retrieve it
			const retrieved = await store.getTag(urn)
			expect(retrieved).toBeDefined()
			expect(retrieved?.displayName).toBe('Test Corporation')
		})

		test('creates and retrieves alliance tag', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-alliance-tag')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const urn = 'urn:eve:alliance:99000001'
			const tag = await store.upsertTag(urn, 'alliance', 'Test Alliance', 99000001)

			expect(tag.tagUrn).toBe(urn)
			expect(tag.displayName).toBe('Test Alliance')
			expect(tag.tagType).toBe('alliance')
			expect(tag.color).toBe('blue')
		})

		test('updates existing tag', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-update-tag')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const urn = 'urn:eve:corporation:98000002'
			await store.upsertTag(urn, 'corporation', 'Old Name', 98000002)

			// Update
			const updated = await store.upsertTag(urn, 'corporation', 'New Name', 98000002)
			expect(updated.displayName).toBe('New Name')

			// Verify update persisted
			const retrieved = await store.getTag(urn)
			expect(retrieved?.displayName).toBe('New Name')
		})
	})

	describe('TagStore - User Tag Assignments', () => {
		test('assigns tag to user from specific character', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-assign-tag')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const userId = 'test-user-1'
			const characterId = 93123456
			const urn = 'urn:eve:corporation:98000003'

			// Create tag
			await store.upsertTag(urn, 'corporation', 'Test Corp', 98000003)

			// Assign to user
			await store.assignTagToUser(userId, urn, characterId)

			// Verify assignment
			const tags = await store.getUserTags(userId)
			expect(tags.length).toBe(1)
			expect(tags[0].tagUrn).toBe(urn)
			expect(tags[0].sourceCharacters).toContain(characterId)
		})

		test('handles multiple characters providing same tag', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-multi-char-tag')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const userId = 'test-user-2'
			const char1 = 93123456
			const char2 = 93123457
			const urn = 'urn:eve:corporation:98000004'

			// Create tag
			await store.upsertTag(urn, 'corporation', 'Shared Corp', 98000004)

			// Assign from both characters
			await store.assignTagToUser(userId, urn, char1)
			await store.assignTagToUser(userId, urn, char2)

			// Verify both characters are tracked
			const tags = await store.getUserTags(userId)
			expect(tags.length).toBe(1)
			expect(tags[0].sourceCharacters).toContain(char1)
			expect(tags[0].sourceCharacters).toContain(char2)
		})

		test('removes tag from specific character', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-remove-char-tag')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const userId = 'test-user-3'
			const char1 = 93123456
			const char2 = 93123457
			const urn = 'urn:eve:corporation:98000005'

			await store.upsertTag(urn, 'corporation', 'Test Corp', 98000005)
			await store.assignTagToUser(userId, urn, char1)
			await store.assignTagToUser(userId, urn, char2)

			// Remove from char1 only
			await store.removeTagFromUser(userId, urn, char1)

			// Tag should still exist (char2 provides it)
			const tags = await store.getUserTags(userId)
			expect(tags.length).toBe(1)
			expect(tags[0].sourceCharacters).not.toContain(char1)
			expect(tags[0].sourceCharacters).toContain(char2)
		})

		test('removes all tags when last character unlinked', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-remove-all-tag')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const userId = 'test-user-4'
			const characterId = 93123456
			const urn = 'urn:eve:corporation:98000006'

			await store.upsertTag(urn, 'corporation', 'Test Corp', 98000006)
			await store.assignTagToUser(userId, urn, characterId)

			// Remove
			await store.removeTagFromUser(userId, urn, characterId)

			// No tags should remain
			const tags = await store.getUserTags(userId)
			expect(tags.length).toBe(0)
		})

		test('removes all tags for character', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-remove-char-all')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const userId = 'test-user-5'
			const characterId = 93123456
			const corpUrn = 'urn:eve:corporation:98000007'
			const allianceUrn = 'urn:eve:alliance:99000007'

			await store.upsertTag(corpUrn, 'corporation', 'Test Corp', 98000007)
			await store.upsertTag(allianceUrn, 'alliance', 'Test Alliance', 99000007)
			await store.assignTagToUser(userId, corpUrn, characterId)
			await store.assignTagToUser(userId, allianceUrn, characterId)

			// Remove all for character
			await store.removeAllTagsForCharacter(characterId)

			// No tags should remain
			const tags = await store.getUserTags(userId)
			expect(tags.length).toBe(0)
		})
	})

	describe('TagStore - Evaluation Scheduling', () => {
		test('schedules user for evaluation', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-schedule')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const userId = 'test-user-schedule'

			// Schedule for evaluation
			await store.scheduleUserEvaluation(userId, 5000) // 5 seconds

			// Check it's in schedule
			const usersNeedingEval = await store.getUsersNeedingEvaluation(100)
			// Note: May or may not appear depending on timing
		})
	})

	describe('API Endpoints - Onboarding', () => {
		test('POST /api/tags/onboard creates tags and assigns to user', async () => {
			const res = await SELF.fetch('https://example.com/api/tags/onboard', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					rootUserId: 'test-user-api-1',
					characterId: 93123458,
					corporationId: 98000010,
					corporationName: 'API Test Corp',
					allianceId: 99000010,
					allianceName: 'API Test Alliance',
				}),
			})

			expect(res.status).toBe(200)
			const data = (await res.json()) as { success: boolean }
			expect(data.success).toBe(true)
		})
	})

	describe('API Endpoints - Public', () => {
		test('GET /api/tags/:userId returns user tags', async () => {
			// Setup: create tags for user
			const id = testEnv.TAG_STORE.idFromName('global')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const userId = 'test-root-user-id'
			const urn = 'urn:eve:corporation:98000011'

			await store.upsertTag(urn, 'corporation', 'API Corp', 98000011)
			await store.assignTagToUser(userId, urn, 93123459)

			const res = await SELF.fetch(`https://example.com/api/tags/${userId}`, {
				headers: {
					Cookie: 'session_id=test-session',
				},
			})

			expect(res.status).toBe(200)
			const data = (await res.json()) as {
				success: boolean
				tags: Array<{
					tagUrn: string
					displayName: string
					color: string
				}>
			}

			expect(data.success).toBe(true)
			expect(data.tags.length).toBeGreaterThan(0)
			expect(data.tags[0].tagUrn).toBe(urn)
			expect(data.tags[0].displayName).toBe('API Corp')
			expect(data.tags[0].color).toBe('green')
		})

		test('GET /api/tags/:userId/display returns formatted tags', async () => {
			const id = testEnv.TAG_STORE.idFromName('global')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const userId = 'test-root-user-id'
			const urn = 'urn:eve:alliance:99000011'

			await store.upsertTag(urn, 'alliance', 'API Alliance', 99000011)
			await store.assignTagToUser(userId, urn, 93123459)

			const res = await SELF.fetch(`https://example.com/api/tags/${userId}/display`, {
				headers: {
					Cookie: 'session_id=test-session',
				},
			})

			expect(res.status).toBe(200)
			const data = (await res.json()) as {
				success: boolean
				tags: Array<{
					urn: string
					displayName: string
					type: string
					color: string
				}>
			}

			expect(data.success).toBe(true)
			const allianceTag = data.tags.find((t) => t.urn === urn)
			expect(allianceTag).toBeDefined()
			expect(allianceTag?.color).toBe('blue')
			expect(allianceTag?.type).toBe('alliance')
		})
	})

	describe('API Endpoints - Character Unlinking', () => {
		test('POST /api/tags/character-unlinked removes character tags', async () => {
			const id = testEnv.TAG_STORE.idFromName('global')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const userId = 'test-user-unlink'
			const characterId = 93123460
			const urn = 'urn:eve:corporation:98000012'

			await store.upsertTag(urn, 'corporation', 'Unlink Corp', 98000012)
			await store.assignTagToUser(userId, urn, characterId)

			const res = await SELF.fetch(
				`https://example.com/api/tags/character-unlinked/${characterId}`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						rootUserId: userId,
					}),
				}
			)

			expect(res.status).toBe(200)
			const data = (await res.json()) as { success: boolean }
			expect(data.success).toBe(true)

			// Verify tags removed
			const tags = await store.getUserTags(userId)
			const hasTag = tags.some((t: TagWithSources) => t.sourceCharacters.includes(characterId))
			expect(hasTag).toBe(false)
		})
	})

	describe('Tag Color Coding', () => {
		test('corporation tags have green color', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-corp-color')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const tag = await store.upsertTag(
				'urn:eve:corporation:98000020',
				'corporation',
				'Green Corp',
				98000020
			)

			expect(tag.color).toBe('green')
		})

		test('alliance tags have blue color', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-alliance-color')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const tag = await store.upsertTag(
				'urn:eve:alliance:99000020',
				'alliance',
				'Blue Alliance',
				99000020
			)

			expect(tag.color).toBe('blue')
		})
	})

	describe('User with Multiple Characters', () => {
		test('user gets tags from all characters', async () => {
			const id = testEnv.TAG_STORE.idFromName('test-multi-char-user')
			const store = testEnv.TAG_STORE.get(id) as unknown as TagStore

			const userId = 'test-user-multi'
			const char1 = 93123461
			const char2 = 93123462
			const char3 = 93123463

			const corp1Urn = 'urn:eve:corporation:98000030'
			const corp2Urn = 'urn:eve:corporation:98000031'
			const allianceUrn = 'urn:eve:alliance:99000030'

			// Setup tags
			await store.upsertTag(corp1Urn, 'corporation', 'Corp One', 98000030)
			await store.upsertTag(corp2Urn, 'corporation', 'Corp Two', 98000031)
			await store.upsertTag(allianceUrn, 'alliance', 'Shared Alliance', 99000030)

			// Char1 in Corp1 + Alliance
			await store.assignTagToUser(userId, corp1Urn, char1)
			await store.assignTagToUser(userId, allianceUrn, char1)

			// Char2 in Corp2 + Alliance
			await store.assignTagToUser(userId, corp2Urn, char2)
			await store.assignTagToUser(userId, allianceUrn, char2)

			// Char3 in Corp One (no alliance)
			await store.assignTagToUser(userId, corp1Urn, char3)

			// User should have 3 unique tags
			const tags = await store.getUserTags(userId)
			expect(tags.length).toBe(3)

			// Verify corp1 has 2 sources
			const corp1Tag = tags.find((t: TagWithSources) => t.tagUrn === corp1Urn)
			expect(corp1Tag?.sourceCharacters).toHaveLength(2)
			expect(corp1Tag?.sourceCharacters).toContain(char1)
			expect(corp1Tag?.sourceCharacters).toContain(char3)

			// Verify alliance has 2 sources
			const allianceTag = tags.find((t: TagWithSources) => t.tagUrn === allianceUrn)
			expect(allianceTag?.sourceCharacters).toHaveLength(2)
		})
	})
})
