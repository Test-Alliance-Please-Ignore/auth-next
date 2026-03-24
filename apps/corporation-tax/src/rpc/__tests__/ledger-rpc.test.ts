import { describe, expect, it, vi } from 'vitest'

import { TaxLedgerRpc } from '../ledger-rpc'

describe('TaxLedgerRpc processable-corporation guardrails', () => {
	function createContext(overrides?: {
		managedCorp?: { corporationId: string } | null
		attachedRuleGroup?: { corporationId: string } | null
		exclusion?: { corporationId: string } | null
	}) {
		const assessmentService = {
			runAssessmentForPeriod: vi.fn(),
			rebuildFinalizedRollupsForPeriod: vi.fn(),
			listAssessments: vi.fn(),
			listAssessmentLines: vi.fn(),
			listDiscrepancies: vi.fn(),
		}

		const ctx = {
			db: {
				query: {
					managedCorporations: {
						findFirst: vi.fn().mockResolvedValue(overrides?.managedCorp ?? null),
					},
					taxRuleGroupAttachments: {
						findFirst: vi.fn().mockResolvedValue(overrides?.attachedRuleGroup ?? null),
					},
					taxCorporationExclusions: {
						findFirst: vi.fn().mockResolvedValue(overrides?.exclusion ?? null),
					},
					taxMemberSummaryVersions: {
						findFirst: vi.fn().mockResolvedValue(null),
					},
				},
			},
			ledgerService: {
				ingestCorporationLedgerWindow: vi.fn(),
				getIngestionHealth: vi.fn(),
				listLedgerEntries: vi.fn(),
				listLedgerParties: vi.fn(),
				trimLedgerEntries: vi.fn(),
			},
			assessmentService,
			auditService: {
				logAction: vi.fn(),
			},
			alertService: {
				triggerAlert: vi.fn(),
			},
			rulesService: {
				getEarliestRuleSetMutationAfter: vi.fn(),
			},
			triggerEssQualityAlerts: vi.fn(),
			triggerUnexpectedIncomeRefTypeAlerts: vi.fn(),
			getCurrentMonthWindow: vi.fn().mockReturnValue({
				periodStart: new Date('2026-03-01T00:00:00.000Z'),
				periodEnd: new Date('2026-03-31T23:59:59.999Z'),
			}),
			runAssessmentForPeriod: vi.fn(),
			clearRuleMembershipMutation: vi.fn(),
			withCorporationIngestLock: vi.fn((_corporationId: string, run: () => Promise<unknown>) =>
				run()
			),
			triggeredIngestOverlapWindowMs: 60_000,
		}

		return { ctx: ctx as any, assessmentService }
	}

	it('skips projection refresh for ineligible corporations', async () => {
		const { ctx } = createContext({
			managedCorp: null,
			attachedRuleGroup: { corporationId: '98792038' },
			exclusion: null,
		})
		const rpc = new TaxLedgerRpc(ctx)

		const result = await rpc.triggerProjectionRefreshFromWalletSync('system:test', {
			corporationId: '98792038',
			upstreamRunId: 'run-1',
			triggeredAt: new Date('2026-03-23T00:00:00.000Z'),
			includeCharacterWallets: true,
			walletJournal: {
				maxId: '100',
				maxDate: new Date('2026-03-23T00:00:00.000Z'),
				fetchedCount: 1,
			},
		})

		expect(result).toEqual({
			corporationId: '98792038',
			triggered: false,
			reason: 'not_processable',
		})
		expect(ctx.ledgerService.getIngestionHealth).not.toHaveBeenCalled()
	})

	it('rejects direct assessment run for ineligible corporations', async () => {
		const { ctx, assessmentService } = createContext({
			managedCorp: { corporationId: '98792038' },
			attachedRuleGroup: null,
			exclusion: null,
		})
		const rpc = new TaxLedgerRpc(ctx)

		await expect(
			rpc.runAssessmentForPeriod('system:test', {
				corporationId: '98792038',
				periodStart: new Date('2026-03-01T00:00:00.000Z'),
				periodEnd: new Date('2026-03-31T23:59:59.999Z'),
				includeCharacterWallets: false,
			})
		).rejects.toThrow('not eligible')
		expect(assessmentService.runAssessmentForPeriod).not.toHaveBeenCalled()
	})
})
