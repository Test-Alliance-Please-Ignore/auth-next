import { describe, expect, it, vi } from 'vitest'

import { AdminService } from './admin.service'

function makeDb() {
	return {
		insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
	}
}

function makeDependencies() {
	return {
		db: makeDb(),
		eveTokenStore: { getAccessToken: vi.fn() },
		eveCharacterData: { getCharacterInfo: vi.fn() },
		coreWorker: {
			deleteUser: vi.fn(),
			transferCharacterOwnership: vi.fn(),
			deleteCharacter: vi.fn(),
			searchUsers: vi.fn(),
			getUserDetails: vi.fn(),
			getCharacterOwnership: vi.fn(),
		},
	}
}

describe('AdminService', () => {
	it('delegates user deletion and records an audit event', async () => {
		const dependencies = makeDependencies()
		dependencies.coreWorker.deleteUser.mockResolvedValue({
			success: true,
			deletedUserId: 'user-1',
			deletedCharacterIds: ['char-1'],
			tokensRevoked: 1,
		})
		const service = new AdminService(
			dependencies.db as any,
			dependencies.eveTokenStore as any,
			dependencies.eveCharacterData as any,
			dependencies.coreWorker as any
		)

		const result = await service.deleteUser('user-1', 'admin-1')

		expect(result.success).toBe(true)
		expect(dependencies.coreWorker.deleteUser).toHaveBeenCalledWith('user-1')
		expect(dependencies.db.insert).toHaveBeenCalledOnce()
	})

	it('delegates character transfer with the expected arguments', async () => {
		const dependencies = makeDependencies()
		dependencies.coreWorker.transferCharacterOwnership.mockResolvedValue({
			success: true,
			characterId: 'char-1',
			oldUserId: 'user-1',
			newUserId: 'user-2',
			tokensRevoked: 0,
		})
		const service = new AdminService(
			dependencies.db as any,
			dependencies.eveTokenStore as any,
			dependencies.eveCharacterData as any,
			dependencies.coreWorker as any
		)

		await service.transferCharacterOwnership('char-1', 'user-2', 'admin-1')

		expect(dependencies.coreWorker.transferCharacterOwnership).toHaveBeenCalledWith(
			'char-1',
			'user-2'
		)
	})

	it('does not fail the operation when audit logging fails', async () => {
		const dependencies = makeDependencies()
		dependencies.coreWorker.deleteCharacter.mockResolvedValue({
			success: true,
			characterId: 'char-1',
			userId: 'user-1',
			tokensRevoked: 0,
		})
		dependencies.db.insert.mockReturnValue({
			values: vi.fn().mockRejectedValue(new Error('audit unavailable')),
		})
		const service = new AdminService(
			dependencies.db as any,
			dependencies.eveTokenStore as any,
			dependencies.eveCharacterData as any,
			dependencies.coreWorker as any
		)

		await expect(service.deleteCharacter('char-1', 'admin-1')).resolves.toMatchObject({
			success: true,
		})
	})

	it('delegates searches and records the result count', async () => {
		const dependencies = makeDependencies()
		const result = { users: [{ id: 'user-1' }], total: 1, limit: 50, offset: 0 }
		dependencies.coreWorker.searchUsers.mockResolvedValue(result)
		const service = new AdminService(
			dependencies.db as any,
			dependencies.eveTokenStore as any,
			dependencies.eveCharacterData as any,
			dependencies.coreWorker as any
		)

		expect(await service.searchUsers({ search: 'user-1' }, 'admin-1')).toEqual(result)
		expect(dependencies.coreWorker.searchUsers).toHaveBeenCalledWith({ search: 'user-1' })
	})

	it('combines ownership, character data, and token validity', async () => {
		const dependencies = makeDependencies()
		dependencies.coreWorker.getCharacterOwnership.mockResolvedValue({
			userId: 'user-1',
			userMainCharacterId: 'char-1',
		})
		dependencies.eveCharacterData.getCharacterInfo.mockResolvedValue({
			name: 'Test Character',
			corporationId: 123,
			updatedAt: new Date('2026-01-01T00:00:00Z'),
		})
		dependencies.eveTokenStore.getAccessToken.mockResolvedValue('token')
		const service = new AdminService(
			dependencies.db as any,
			dependencies.eveTokenStore as any,
			dependencies.eveCharacterData as any,
			dependencies.coreWorker as any
		)

		const result = await service.getCharacterDetails('char-1', 'admin-1')

		expect(result).toMatchObject({
			characterId: 'char-1',
			characterName: 'Test Character',
			hasValidToken: true,
			owner: { userId: 'user-1' },
		})
	})
})
