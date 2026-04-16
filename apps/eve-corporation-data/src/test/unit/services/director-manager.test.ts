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

		const selected = await manager.selectDirector()

		expect(onAffiliationMismatch).toHaveBeenCalledWith('111', '98000001', '98000002')
		expect(safeRecordFailure).toHaveBeenCalledWith(
			'dir-1',
			'Director affiliation mismatch: expected corporation 98000001, got 98000002'
		)
		expect(selected).toEqual({
			directorId: 'dir-2',
			characterId: '222',
			characterName: 'Valid Director',
		})
		expect(safeMarkSelected).toHaveBeenCalledWith('dir-2')
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
				lastFailureReason: 'ESI request failed: 403 Forbidden',
			})
		)
		expect(set.mock.calls[0][0].failureCount).toBeGreaterThanOrEqual(3)
	})
})
