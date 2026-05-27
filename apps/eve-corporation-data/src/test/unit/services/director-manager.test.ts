import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DirectorManager } from '../../../services/director-manager'

describe('DirectorManager.selectDirector', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('handles affiliation mismatch and continues selecting a valid director', async () => {
		const onAffiliationMismatch = vi.fn().mockResolvedValue(undefined)
		const tokenStore = {
			getTokenInfo: vi.fn().mockResolvedValue({ isExpired: false }),
			refreshToken: vi.fn().mockResolvedValue(true),
		}
		const manager = new DirectorManager(
			{} as never,
			'98000001',
			tokenStore as never,
			onAffiliationMismatch
		)

		vi.spyOn(manager as any, 'getHealthyDirectors').mockResolvedValue([
			{
				directorId: 'dir-1',
				characterId: '111',
				characterName: 'Mismatch Director',
				isHealthy: true,
				lastHealthCheck: null,
				lastUsed: null,
				failureCount: 0,
				lastFailureReason: null,
				priority: 1,
			},
			{
				directorId: 'dir-2',
				characterId: '222',
				characterName: 'Valid Director',
				isHealthy: true,
				lastHealthCheck: null,
				lastUsed: null,
				failureCount: 0,
				lastFailureReason: null,
				priority: 2,
			},
		])
		vi.spyOn(manager as any, 'checkAffiliation')
			.mockResolvedValueOnce({ matches: false, corporationId: '98000002' })
			.mockResolvedValueOnce({ matches: true, corporationId: '98000001' })
		const safeRecordFailure = vi
			.spyOn(manager as any, 'safeRecordFailure')
			.mockResolvedValue(undefined)
		const safeMarkSelected = vi
			.spyOn(manager as any, 'safeMarkSelected')
			.mockResolvedValue(undefined)
		const removeDirector = vi.spyOn(manager, 'removeDirector').mockResolvedValue(undefined)

		const selected = await manager.selectDirector()

		expect(onAffiliationMismatch).toHaveBeenCalledWith('111', '98000001', '98000002')
		expect(safeRecordFailure).toHaveBeenCalledWith(
			'dir-1',
			'Director affiliation mismatch: expected corporation 98000001, got 98000002',
			{ forceUnhealthy: true }
		)
		expect(removeDirector).toHaveBeenCalledWith('111')
		expect(selected).toEqual({
			directorId: 'dir-2',
			characterId: '222',
			characterName: 'Valid Director',
		})
		expect(safeMarkSelected).toHaveBeenCalledWith('dir-2')
	})

	it('prefilters by required roles and honors CEO override', async () => {
		const tokenStore = {
			getTokenInfo: vi.fn().mockResolvedValue({ isExpired: false }),
			refreshToken: vi.fn().mockResolvedValue(true),
			fetchEsi: vi
				.fn()
				.mockResolvedValueOnce({
					data: { roles: ['Trader'] },
				})
				.mockResolvedValueOnce({
					data: { roles: ['CEO'] },
				}),
		}
		const manager = new DirectorManager(
			{} as never,
			'98000001',
			tokenStore as never
		)

		vi.spyOn(manager as any, 'getHealthyDirectors').mockResolvedValue([
			{
				directorId: 'dir-1',
				characterId: '111',
				characterName: 'Trader Only',
				isHealthy: true,
				lastHealthCheck: null,
				lastUsed: null,
				failureCount: 0,
				lastFailureReason: null,
				priority: 1,
			},
			{
				directorId: 'dir-2',
				characterId: '222',
				characterName: 'CEO Director',
				isHealthy: true,
				lastHealthCheck: null,
				lastUsed: null,
				failureCount: 0,
				lastFailureReason: null,
				priority: 2,
			},
		])
		vi.spyOn(manager as any, 'checkAffiliation').mockResolvedValue({
			matches: true,
			corporationId: '98000001',
		})
		const safeRecordFailure = vi
			.spyOn(manager as any, 'safeRecordFailure')
			.mockResolvedValue(undefined)
		const safeMarkSelected = vi
			.spyOn(manager as any, 'safeMarkSelected')
			.mockResolvedValue(undefined)

		const selected = await manager.selectDirector({
			requiredRoleSets: [['Director'], ['Accountant', 'Junior_Accountant']],
		})

		expect(safeRecordFailure).toHaveBeenCalledWith(
			'dir-1',
			expect.stringContaining('Director missing required roles for selection'),
			{ forceUnhealthy: true }
		)
		expect(selected).toEqual({
			directorId: 'dir-2',
			characterId: '222',
			characterName: 'CEO Director',
		})
		expect(safeMarkSelected).toHaveBeenCalledWith('dir-2')
	})
})

describe('DirectorManager.checkAffiliation', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('uses token store affiliation RPC and matches corporation', async () => {
		const tokenStore = {
			fetchCharacterAffiliations: vi.fn().mockResolvedValue({
				data: [{ character_id: 111, corporation_id: 98000001 }],
			}),
		}
		const manager = new DirectorManager(
			{} as never,
			'98000001',
			tokenStore as never
		)

		const result = await (manager as any).checkAffiliation('111')

		expect(tokenStore.fetchCharacterAffiliations).toHaveBeenCalledWith(['111'])
		expect(result).toEqual({ matches: true, corporationId: '98000001' })
	})
})

describe('DirectorManager.recordFailure', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('can force-mark a director unhealthy for auth failures', async () => {
		const where = vi.fn().mockResolvedValue(undefined)
		const set = vi.fn().mockReturnValue({ where })
		const update = vi.fn().mockReturnValue({ set })
		const db = {
			query: {
				corporationDirectors: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'dir-1',
						characterId: '111',
						failureCount: 0,
						isHealthy: true,
					}),
				},
			},
			update,
		}
		const manager = new DirectorManager(
			db as never,
			'98000001',
			{} as never
		)
		vi.spyOn(manager, 'getHealthyDirectorsCount').mockResolvedValue(1)

		await manager.recordFailure('dir-1', 'ESI request failed: 403 Forbidden', {
			forceUnhealthy: true,
		})

		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				isHealthy: false,
				lastFailureReason: '[PERMANENT] ESI request failed: 403 Forbidden',
				permanentFailureAt: expect.any(Date),
			})
		)
		expect(set.mock.calls[0][0].failureCount).toBeGreaterThanOrEqual(3)
	})

	it('applies transient cooldown on 429 failures instead of permanent unhealthy marking', async () => {
		const where = vi.fn().mockResolvedValue(undefined)
		const set = vi.fn().mockReturnValue({ where })
		const update = vi.fn().mockReturnValue({ set })
		const db = {
			query: {
				corporationDirectors: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'dir-1',
						characterId: '111',
						failureCount: 0,
						isHealthy: true,
						permanentFailureAt: null,
					}),
				},
			},
			update,
		}
		const manager = new DirectorManager(
			db as never,
			'98000001',
			{} as never
		)

		await manager.recordFailure(
			'dir-1',
			'ESI request failed: 429 Too Many Requests | metadata={"status":429}'
		)

		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				isHealthy: false,
				lastFailureReason: expect.stringContaining('429'),
				nextRetryAt: expect.any(Date),
			})
		)
		const args = set.mock.calls[0][0]
		expect(args.permanentFailureAt).toBeUndefined()
	})
})

describe('DirectorManager.verifyDirectorHealth', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('stores roles and marks director healthy when required roles are satisfied', async () => {
		const rolesUpsert = vi.fn().mockResolvedValue(undefined)
		const rolesValues = vi.fn().mockReturnValue({ onConflictDoUpdate: rolesUpsert })
		const insert = vi.fn().mockReturnValue({ values: rolesValues })
		const where = vi.fn().mockResolvedValue(undefined)
		const set = vi.fn().mockReturnValue({ where })
		const update = vi.fn().mockReturnValue({ set })
		const db = {
			query: {
				corporationDirectors: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'dir-1',
						characterId: '111',
					}),
				},
			},
			insert,
			update,
		}
		const tokenStore = {
			fetchCharacterAffiliations: vi.fn().mockResolvedValue({
				data: [{ character_id: 111, corporation_id: 98000001 }],
			}),
			fetchEsi: vi.fn().mockResolvedValue({
				data: {
					roles: ['Trader'],
					roles_at_hq: ['Station_Manager'],
				},
			}),
		}
		const manager = new DirectorManager(
			db as never,
			'98000001',
			tokenStore as never
		)

		const result = await manager.verifyDirectorHealth('dir-1', {
			requiredRoleSets: [['Station_Manager'], ['Trader', 'Accountant']],
		})

		expect(result).toBe(true)
		expect(tokenStore.fetchCharacterAffiliations).toHaveBeenCalledWith(['111'])
		expect(tokenStore.fetchEsi).toHaveBeenCalledWith('/characters/111/roles', '111')
		expect(rolesValues).toHaveBeenCalledWith(
			expect.objectContaining({
				corporationId: '98000001',
				characterId: '111',
				roles: ['Trader'],
				rolesAtHq: ['Station_Manager'],
			})
		)
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				isHealthy: true,
				failureCount: 0,
				lastFailureReason: null,
			})
		)
	})

	it('marks unhealthy when required role sets are missing', async () => {
		const rolesUpsert = vi.fn().mockResolvedValue(undefined)
		const rolesValues = vi.fn().mockReturnValue({ onConflictDoUpdate: rolesUpsert })
		const insert = vi.fn().mockReturnValue({ values: rolesValues })
		const where = vi.fn().mockResolvedValue(undefined)
		const set = vi.fn().mockReturnValue({ where })
		const update = vi.fn().mockReturnValue({ set })
		const db = {
			query: {
				corporationDirectors: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'dir-1',
						characterId: '111',
					}),
				},
			},
			insert,
			update,
		}
		const tokenStore = {
			fetchCharacterAffiliations: vi.fn().mockResolvedValue({
				data: [{ character_id: 111, corporation_id: 98000001 }],
			}),
			fetchEsi: vi.fn().mockResolvedValue({
				data: {
					roles: ['Trader'],
				},
			}),
		}
		const manager = new DirectorManager(
			db as never,
			'98000001',
			tokenStore as never
		)
		const recordFailure = vi.spyOn(manager, 'recordFailure').mockResolvedValue(undefined)

		const result = await manager.verifyDirectorHealth('dir-1', {
			requiredRoleSets: [['Factory_Manager']],
		})

		expect(result).toBe(false)
		expect(recordFailure).toHaveBeenCalledWith(
			'dir-1',
			expect.stringContaining('Director missing required roles'),
			{ forceUnhealthy: true }
		)
	})

	it('records failure when ESI role fetch throws', async () => {
		const db = {
			query: {
				corporationDirectors: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'dir-1',
						characterId: '111',
					}),
				},
			},
		}
		const tokenStore = {
			fetchCharacterAffiliations: vi.fn().mockResolvedValue({
				data: [{ character_id: 111, corporation_id: 98000001 }],
			}),
			fetchEsi: vi.fn().mockRejectedValue(new Error('ESI request failed: 403 Forbidden')),
		}
		const manager = new DirectorManager(
			db as never,
			'98000001',
			tokenStore as never
		)
		const recordFailure = vi.spyOn(manager, 'recordFailure').mockResolvedValue(undefined)

		const result = await manager.verifyDirectorHealth('dir-1')

		expect(result).toBe(false)
		expect(recordFailure).toHaveBeenCalledWith('dir-1', 'ESI request failed: 403 Forbidden')
	})

	it('auto-prunes director when affiliation check fails during verify health', async () => {
		const db = {
			query: {
				corporationDirectors: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'dir-1',
						characterId: '111',
					}),
				},
			},
		}
		const onAffiliationMismatch = vi.fn().mockResolvedValue(undefined)
		const tokenStore = {
			fetchCharacterAffiliations: vi.fn().mockResolvedValue({
				data: [{ character_id: 111, corporation_id: 98000002 }],
			}),
			fetchEsi: vi.fn(),
		}
		const manager = new DirectorManager(
			db as never,
			'98000001',
			tokenStore as never,
			onAffiliationMismatch
		)
		const removeDirector = vi.spyOn(manager, 'removeDirector').mockResolvedValue(undefined)
		const recordFailure = vi.spyOn(manager, 'recordFailure').mockResolvedValue(undefined)

		const result = await manager.verifyDirectorHealth('dir-1')

		expect(result).toBe(false)
		expect(onAffiliationMismatch).toHaveBeenCalledWith('111', '98000001', '98000002')
		expect(recordFailure).toHaveBeenCalledWith(
			'dir-1',
			'Director affiliation mismatch: expected corporation 98000001, got 98000002',
			{ forceUnhealthy: true }
		)
		expect(removeDirector).toHaveBeenCalledWith('111')
		expect(tokenStore.fetchEsi).not.toHaveBeenCalled()
	})
})

describe('DirectorManager.verifyAllDirectorsHealth', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('aggregates verification results and marks corporation verified when any director passes', async () => {
		const where = vi.fn().mockResolvedValue(undefined)
		const set = vi.fn().mockReturnValue({ where })
		const update = vi.fn().mockReturnValue({ set })
		const manager = new DirectorManager(
			{ update } as never,
			'98000001',
			{} as never
		)

		vi.spyOn(manager, 'getAllDirectors').mockResolvedValue([
			{
				directorId: 'dir-1',
				characterId: '111',
				characterName: 'A',
				isHealthy: true,
				lastHealthCheck: null,
				lastUsed: null,
				failureCount: 0,
				lastFailureReason: null,
				priority: 1,
			},
			{
				directorId: 'dir-2',
				characterId: '222',
				characterName: 'B',
				isHealthy: false,
				lastHealthCheck: null,
				lastUsed: null,
				failureCount: 2,
				lastFailureReason: 'bad',
				priority: 2,
			},
		])
		vi.spyOn(manager, 'verifyDirectorHealth')
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)

		const result = await manager.verifyAllDirectorsHealth()

		expect(result).toEqual({ verified: 1, failed: 1 })
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				isVerified: true,
			})
		)
	})

	it('marks corporation unverified when all director checks fail', async () => {
		const where = vi.fn().mockResolvedValue(undefined)
		const set = vi.fn().mockReturnValue({ where })
		const update = vi.fn().mockReturnValue({ set })
		const manager = new DirectorManager(
			{ update } as never,
			'98000001',
			{} as never
		)

		vi.spyOn(manager, 'getAllDirectors').mockResolvedValue([
			{
				directorId: 'dir-1',
				characterId: '111',
				characterName: 'A',
				isHealthy: false,
				lastHealthCheck: null,
				lastUsed: null,
				failureCount: 3,
				lastFailureReason: 'bad',
				priority: 1,
			},
		])
		vi.spyOn(manager, 'verifyDirectorHealth').mockResolvedValue(false)

		const result = await manager.verifyAllDirectorsHealth()

		expect(result).toEqual({ verified: 0, failed: 1 })
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				isVerified: false,
			})
		)
	})

	it('skips verification for directors in cooldown and counts them as failed', async () => {
		const where = vi.fn().mockResolvedValue(undefined)
		const set = vi.fn().mockReturnValue({ where })
		const update = vi.fn().mockReturnValue({ set })
		const manager = new DirectorManager(
			{ update } as never,
			'98000001',
			{} as never
		)
		const verifyDirectorHealth = vi.spyOn(manager, 'verifyDirectorHealth').mockResolvedValue(true)

		vi.spyOn(manager, 'getAllDirectors').mockResolvedValue([
			{
				directorId: 'dir-1',
				characterId: '111',
				characterName: 'Cooldown',
				isHealthy: false,
				lastHealthCheck: null,
				lastUsed: null,
				failureCount: 1,
				lastFailureReason: 'ESI request failed: 429 Too Many Requests',
				nextRetryAt: new Date(Date.now() + 60_000),
				priority: 1,
			},
		])

		const result = await manager.verifyAllDirectorsHealth()

		expect(verifyDirectorHealth).not.toHaveBeenCalled()
		expect(result).toEqual({ verified: 0, failed: 1 })
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				isVerified: false,
			})
		)
	})

	it('applies 7-day stale invalid backstop to non-permanent unhealthy directors', async () => {
		const staleAnchor = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
		const directorWhere = vi.fn().mockResolvedValue(undefined)
		const directorSet = vi.fn().mockReturnValue({ where: directorWhere })
		const corpWhere = vi.fn().mockResolvedValue(undefined)
		const corpSet = vi.fn().mockReturnValue({ where: corpWhere })
		const update = vi
			.fn()
			.mockReturnValueOnce({ set: directorSet })
			.mockReturnValueOnce({ set: corpSet })
		const manager = new DirectorManager(
			{ update } as never,
			'98000001',
			{} as never
		)
		vi.spyOn(manager, 'verifyDirectorHealth')
			.mockResolvedValueOnce(false)
		vi.spyOn(manager, 'getAllDirectors').mockResolvedValue([
			{
				directorId: 'dir-1',
				characterId: '111',
				characterName: 'Stale',
				isHealthy: false,
				lastHealthCheck: staleAnchor,
				lastUsed: null,
				failureCount: 20,
				lastFailureReason: 'Director token expired and refresh failed',
				nextRetryAt: null,
				permanentFailureAt: null,
				priority: 1,
				updatedAt: staleAnchor,
			},
		])

		const result = await manager.verifyAllDirectorsHealth()

		expect(result).toEqual({ verified: 0, failed: 1 })
		expect(directorSet).toHaveBeenCalledWith(
			expect.objectContaining({
				isHealthy: false,
				permanentFailureAt: expect.any(Date),
				lastFailureReason: expect.stringContaining('[PERMANENT]'),
			})
		)
	})
})
