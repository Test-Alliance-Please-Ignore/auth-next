import { describe, expect, it, vi } from 'vitest'

import { TaxRulesService } from '../tax-rules.service'

describe('TaxRulesService', () => {
	it('rejects createRuleSet when priority is out of bounds', async () => {
		const mockDb = {
			query: {
				taxRuleGroups: {
					findFirst: vi.fn(),
				},
			},
		} as any

		const service = new TaxRulesService(mockDb)

		await expect(
			service.createRuleSet('user-1', {
				ruleGroupId: 'group-1',
				name: 'Rule One',
				priority: 101,
				isActive: true,
				appliesToRefType: undefined,
				taxRateBps: 500,
			})
		).rejects.toThrow('Rule priority must be an integer between 0 and 100')
		expect(mockDb.query.taxRuleGroups.findFirst).not.toHaveBeenCalled()
	})

	it('rejects updateRuleSet when priority is out of bounds', async () => {
		const mockDb = {
			update: vi.fn(),
		} as any

		const service = new TaxRulesService(mockDb)

		await expect(
			service.updateRuleSet('rule-1', {
				priority: -1,
			})
		).rejects.toThrow('Rule priority must be an integer between 0 and 100')
		expect(mockDb.update).not.toHaveBeenCalled()
	})

	it('returns earliest rule mutation after projection timestamp', async () => {
		const expected = new Date('2026-03-20T10:00:00.000Z')
		const mockDb = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn().mockResolvedValue([{ ruleGroupId: 'group-1' }]),
					})),
				})),
			})),
			query: {
				taxRuleSets: {
					findFirst: vi.fn().mockResolvedValue({ updatedAt: expected }),
				},
			},
		} as any

		const service = new TaxRulesService(mockDb)
		const result = await service.getEarliestRuleSetMutationAfter(
			'98000001',
			new Date('2026-03-20T00:00:00.000Z')
		)

		expect(result?.toISOString()).toBe(expected.toISOString())
		expect(mockDb.query.taxRuleSets.findFirst).toHaveBeenCalledTimes(1)
	})

	it('returns null when corporation has no attached rule groups', async () => {
		const mockDb = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn().mockResolvedValue([]),
					})),
				})),
			})),
			query: {
				taxRuleSets: {
					findFirst: vi.fn(),
				},
			},
		} as any

		const service = new TaxRulesService(mockDb)
		const result = await service.getEarliestRuleSetMutationAfter(
			'98000001',
			new Date('2026-03-20T00:00:00.000Z')
		)

		expect(result).toBeNull()
		expect(mockDb.query.taxRuleSets.findFirst).not.toHaveBeenCalled()
	})

	it('returns corporation-scoped rule sets from attached groups', async () => {
		const row = {
			id: 'rule-1',
			ruleGroupId: 'group-1',
			name: 'Rule One',
			priority: 100,
			isActive: true,
			appliesToRefType: 'market_transaction',
			taxRateBps: 750,
			createdBy: 'user-1',
			createdAt: new Date('2026-03-01T00:00:00.000Z'),
			updatedAt: new Date('2026-03-10T00:00:00.000Z'),
		}
		const findManyMock = vi.fn().mockResolvedValue([row])
		const mockDb = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn().mockResolvedValue([{ ruleGroupId: 'group-1' }]),
				})),
			})),
			query: {
				taxRuleSets: {
					findMany: findManyMock,
				},
			},
		} as any

		const service = new TaxRulesService(mockDb)
		const result = await service.listRuleSets({
			corporationId: '98000001',
		})

		expect(result).toHaveLength(1)
		expect(result[0]).toMatchObject({
			id: 'rule-1',
			ruleGroupId: 'group-1',
			isActive: true,
			taxRateBps: 750,
		})
		expect(findManyMock).toHaveBeenCalledTimes(1)
	})

	it('updates rule activation state via updateRuleSet', async () => {
		const row = {
			id: 'rule-1',
			ruleGroupId: 'group-1',
			name: 'Rule One',
			priority: 100,
			isActive: false,
			appliesToRefType: null,
			taxRateBps: 750,
			createdBy: 'user-1',
			createdAt: new Date('2026-03-01T00:00:00.000Z'),
			updatedAt: new Date('2026-03-10T00:00:00.000Z'),
		}

		const mockDb = {
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn().mockResolvedValue([{ id: 'rule-1' }]),
					})),
				})),
			})),
			query: {
				taxRuleSets: {
					findFirst: vi.fn().mockResolvedValue(row),
				},
			},
		} as any

		const service = new TaxRulesService(mockDb)
		const result = await service.updateRuleSet('rule-1', { isActive: false })

		expect(result.isActive).toBe(false)
		expect(mockDb.update).toHaveBeenCalledTimes(1)
	})

	it('rejects unsupported appliesToRefType values', async () => {
		const mockDb = {
			update: vi.fn(),
		} as any

		const service = new TaxRulesService(mockDb)

		await expect(
			service.updateRuleSet('rule-1', {
				appliesToRefType: 'definitely_not_income',
			})
		).rejects.toThrow('Rule appliesToRefType must be a valid tax income ref type')
		expect(mockDb.update).not.toHaveBeenCalled()
	})
})
