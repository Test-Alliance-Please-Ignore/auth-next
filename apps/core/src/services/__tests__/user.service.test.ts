import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UserService } from '../user.service'

function createDbMock() {
	const usersFindFirst = vi.fn()
	const userCharactersFindMany = vi.fn()
	const userPreferencesFindFirst = vi.fn()

	return {
		db: {
			query: {
				users: {
					findFirst: usersFindFirst,
				},
				userCharacters: {
					findMany: userCharactersFindMany,
				},
				userPreferences: {
					findFirst: userPreferencesFindFirst,
				},
			},
		},
		usersFindFirst,
		userCharactersFindMany,
		userPreferencesFindFirst,
	}
}

describe('UserService.getUserProfile', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('excludes soft-deleted characters by default', async () => {
		const db = createDbMock()
		const now = new Date('2026-06-16T08:00:00.000Z')
		db.usersFindFirst.mockResolvedValue({
			id: 'user-1',
			mainCharacterId: '1001',
			discordUserId: null,
			is_admin: false,
			legacyAuthUserId: null,
			legacyAuthUserUsername: null,
			createdAt: now,
			updatedAt: now,
		})
		db.userCharactersFindMany.mockResolvedValue([
			{
				id: 'link-1',
				userId: 'user-1',
				characterOwnerHash: 'owner-1',
				characterId: '1001',
				characterName: 'Active Character',
				is_primary: true,
				hasValidToken: true,
				isDeleted: false,
				linkedAt: now,
			},
			{
				id: 'link-2',
				userId: 'user-1',
				characterOwnerHash: 'owner-2',
				characterId: '1002',
				characterName: 'Deleted Character',
				is_primary: false,
				hasValidToken: false,
				isDeleted: true,
				linkedAt: now,
			},
		])
		db.userPreferencesFindFirst.mockResolvedValue({ preferences: {} })

		const service = new UserService(db.db as never)
		const profile = await service.getUserProfile('user-1')

		expect(profile.characters).toHaveLength(1)
		expect(profile.characters[0]).toMatchObject({
			characterId: '1001',
			characterName: 'Active Character',
		})
	})

	it('can include deleted characters when explicitly requested', async () => {
		const db = createDbMock()
		const now = new Date('2026-06-16T08:00:00.000Z')
		db.usersFindFirst.mockResolvedValue({
			id: 'user-1',
			mainCharacterId: '1001',
			discordUserId: null,
			is_admin: false,
			legacyAuthUserId: null,
			legacyAuthUserUsername: null,
			createdAt: now,
			updatedAt: now,
		})
		db.userCharactersFindMany.mockResolvedValue([
			{
				id: 'link-1',
				userId: 'user-1',
				characterOwnerHash: 'owner-1',
				characterId: '1001',
				characterName: 'Active Character',
				is_primary: true,
				hasValidToken: true,
				isDeleted: false,
				linkedAt: now,
			},
			{
				id: 'link-2',
				userId: 'user-1',
				characterOwnerHash: 'owner-2',
				characterId: '1002',
				characterName: 'Deleted Character',
				is_primary: false,
				hasValidToken: false,
				isDeleted: true,
				linkedAt: now,
			},
		])
		db.userPreferencesFindFirst.mockResolvedValue({ preferences: {} })

		const service = new UserService(db.db as never)
		const profile = await service.getUserProfile('user-1', { includeDeleted: true })

		expect(profile.characters).toHaveLength(2)
		expect(profile.characters.map((character) => character.characterId)).toEqual(['1001', '1002'])
	})

	it('uses default preferences when the optional preferences query fails', async () => {
		const db = createDbMock()
		const now = new Date('2026-06-16T08:00:00.000Z')
		db.usersFindFirst.mockResolvedValue({
			id: 'user-1',
			mainCharacterId: '1001',
			discordUserId: null,
			is_admin: false,
			legacyAuthUserId: null,
			legacyAuthUserUsername: null,
			createdAt: now,
			updatedAt: now,
		})
		db.userCharactersFindMany.mockResolvedValue([])
		db.userPreferencesFindFirst.mockRejectedValue(new Error('temporary database failure'))

		const service = new UserService(db.db as never)
		const profile = await service.getUserProfile('user-1')

		expect(profile.preferences).toEqual({})
	})
})
