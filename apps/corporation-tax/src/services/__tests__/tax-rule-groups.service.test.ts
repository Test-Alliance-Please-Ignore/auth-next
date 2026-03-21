import { describe, expect, it, vi } from 'vitest'

import { TaxRuleGroupService } from '../tax-rule-groups.service'

describe('TaxRuleGroupService', () => {
	it('blocks updating the default/system rule group', async () => {
		const mockDb = {
			query: {
				taxRuleGroups: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'default-group',
						isSystem: true,
						isDefaultGlobal: true,
					}),
				},
			},
			update: vi.fn(),
		} as any

		const service = new TaxRuleGroupService(mockDb)

		await expect(service.updateRuleGroup('default-group', { name: 'Nope' })).rejects.toThrow(
			'Default global rule group cannot be updated'
		)
		expect(mockDb.update).not.toHaveBeenCalled()
	})

	it('blocks deleting the default/system rule group', async () => {
		const mockDb = {
			query: {
				taxRuleGroups: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'default-group',
						isSystem: true,
						isDefaultGlobal: true,
					}),
				},
				taxRuleSets: {
					findFirst: vi.fn(),
				},
			},
			delete: vi.fn(),
		} as any

		const service = new TaxRuleGroupService(mockDb)

		await expect(service.deleteRuleGroup('default-group')).rejects.toThrow(
			'Default global rule group cannot be deleted'
		)
		expect(mockDb.query.taxRuleSets.findFirst).not.toHaveBeenCalled()
	})

	it('returns existing attachment on dedupe conflict', async () => {
		const existing = {
			id: 'attach-1',
			ruleGroupId: 'group-1',
			corporationId: '98000001',
			createdAt: new Date('2026-03-20T00:00:00.000Z'),
			updatedAt: new Date('2026-03-20T00:00:00.000Z'),
		}
		const mockDb = {
			insert: vi.fn(() => ({
				values: vi.fn(() => ({
					onConflictDoNothing: vi.fn(() => ({
						returning: vi.fn().mockResolvedValue([]),
					})),
				})),
			})),
			query: {
				taxRuleGroupAttachments: {
					findFirst: vi.fn().mockResolvedValue(existing),
				},
			},
		} as any

		const service = new TaxRuleGroupService(mockDb)
		const result = await service.attachCorporation('group-1', '98000001')

		expect(result).toEqual({
			id: 'attach-1',
			ruleGroupId: 'group-1',
			corporationId: '98000001',
			createdAt: existing.createdAt,
			updatedAt: existing.updatedAt,
		})
		expect(mockDb.query.taxRuleGroupAttachments.findFirst).toHaveBeenCalledTimes(1)
	})
})
