import { beforeEach, describe, expect, it, vi } from 'vitest'

import { taxAssessmentLines, taxAssessments, taxDiscrepancies, taxPeriods } from '../../db/schema'
import { TaxAssessmentService } from '../tax-assessment.service'

const getStubMock = vi.fn()

vi.mock('@repo/do-utils', () => ({
	getStub: (...args: unknown[]) => getStubMock(...args),
}))

describe('TaxAssessmentService', () => {
	let mockDb: any
	let txTaxAssessmentsFindManyMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()

		txTaxAssessmentsFindManyMock = vi.fn()

		mockDb = {
			query: {
				taxCorporationSettings: {
					findFirst: vi.fn().mockResolvedValue({
						corporationId: '98000001',
						included: true,
						defaultRateBps: 1000,
						essRateBps: 2000,
						discrepancyThresholdBps: 500,
					}),
				},
				taxLedgerEntries: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: '9d0a2f54-259b-4f0f-af95-aecacc954f2b',
							corporationId: '98000001',
							refType: 'bounty_prizes',
							amount: '1000',
							division: null,
							entryDate: new Date('2026-01-10T00:00:00.000Z'),
							isEss: false,
							essBankType: null,
							firstPartyId: null,
							secondPartyId: null,
							rawPayload: { tax: '5' },
						},
					]),
				},
				taxRuleSets: {
					findMany: vi.fn().mockResolvedValue([]),
				},
			},
			transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
				let txInsertCall = 0
				const tx = {
					insert: vi.fn(() => ({
						values: vi.fn(() => ({
							onConflictDoUpdate: vi.fn(() => ({
								returning: vi.fn(() => {
									txInsertCall += 1
									if (txInsertCall === 1) {
										return Promise.resolve([
											{
												id: 'period-1',
												corporationId: '98000001',
												periodStart: new Date('2026-01-01T00:00:00.000Z'),
												periodEnd: new Date('2026-01-31T00:00:00.000Z'),
												status: 'assessed',
												closedAt: new Date('2026-01-31T00:00:00.000Z'),
												createdAt: new Date('2026-01-31T00:00:00.000Z'),
												updatedAt: new Date('2026-01-31T00:00:00.000Z'),
											},
										])
									}
									return Promise.resolve([])
								}),
							})),
							returning: vi.fn(() => {
								txInsertCall += 1
								if (txInsertCall === 2) {
									return Promise.resolve([
										{
											id: 'assessment-1',
											corporationId: '98000001',
											taxPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
											taxPeriodEnd: new Date('2026-01-31T00:00:00.000Z'),
											assessmentScope: 'corporation',
											scopeId: '98000001',
											taxableIncome: '1000',
											nonTaxableIncome: '0',
											taxDue: '100',
											taxPaid: '5',
											taxDelta: '95',
											status: 'underpaid',
											inGameTaxRateBps: 1200,
											portalTaxRateBps: 1000,
											billId: null,
											billStatus: null,
											billStatusLastSyncedAt: null,
											approvedBy: null,
											approvedAt: null,
											createdAt: new Date('2026-01-31T00:00:00.000Z'),
											updatedAt: new Date('2026-01-31T00:00:00.000Z'),
										},
									])
								}
								return Promise.resolve([])
							}),
						})),
					})),
					update: vi.fn(() => ({
						set: vi.fn(() => ({
							where: vi.fn(() => Promise.resolve()),
						})),
					})),
					delete: vi.fn(() => ({
						where: vi.fn(() => Promise.resolve()),
					})),
					query: {
						taxAssessments: {
							findMany: txTaxAssessmentsFindManyMock,
						},
					},
				}

				txTaxAssessmentsFindManyMock.mockResolvedValue([])

				return callback(tx)
			}),
		}

		getStubMock.mockReturnValue({
			getCorporationTaxMetadata: vi.fn().mockResolvedValue({
				corporationId: '98000001',
				inGameTaxRateBps: 1200,
				ceoId: null,
				memberCount: null,
				allianceId: null,
				updatedAt: null,
			}),
		})
	})

	it('computes deterministic period assessment and writes discrepancy metadata', async () => {
		const service = new TaxAssessmentService(mockDb, {} as DurableObjectNamespace)

		const result = await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: new Date('2026-01-01T00:00:00.000Z'),
			periodEnd: new Date('2026-01-31T00:00:00.000Z'),
		})

		expect(result.assessment.corporationId).toBe('98000001')
		expect(result.assessment.taxDue).toBe('100')
		expect(result.assessment.taxPaid).toBe('5')
		expect(result.assessment.taxDelta).toBe('95')
		expect(result.assessment.status).toBe('underpaid')
		expect(result.lineCount).toBe(1)
		expect(result.discrepancyCount).toBe(1)
		expect(result.divisionSummaries).toHaveLength(1)
		expect(result.divisionSummaries[0]?.division).toBe(null)
		expect(result.refTypeSummaries).toHaveLength(1)
		expect(result.refTypeSummaries[0]?.refType).toBe('bounty_prizes')
	})

	it('produces stable outputs when rerun for the same period', async () => {
		const service = new TaxAssessmentService(mockDb, {} as DurableObjectNamespace)

		const first = await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: new Date('2026-01-01T00:00:00.000Z'),
			periodEnd: new Date('2026-01-31T00:00:00.000Z'),
		})
		const second = await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: new Date('2026-01-01T00:00:00.000Z'),
			periodEnd: new Date('2026-01-31T00:00:00.000Z'),
		})

		expect(second.assessment.taxDue).toBe(first.assessment.taxDue)
		expect(second.assessment.taxPaid).toBe(first.assessment.taxPaid)
		expect(second.assessment.taxDelta).toBe(first.assessment.taxDelta)
		expect(second.assessment.status).toBe(first.assessment.status)
		expect(second.divisionSummaries).toEqual(first.divisionSummaries)
		expect(second.refTypeSummaries).toEqual(first.refTypeSummaries)
		expect(second.discrepancyCount).toBe(first.discrepancyCount)
	})

	it('creates scoped assessments for division and character rollups', async () => {
		const insertedAssessments: any[] = []
		const insertedAssessmentLines: any[] = []

		const scopedDb = {
			query: {
				taxCorporationSettings: {
					findFirst: vi.fn().mockResolvedValue({
						corporationId: '98000001',
						included: true,
						defaultRateBps: 1000,
						essRateBps: 2000,
						discrepancyThresholdBps: 500,
					}),
				},
				taxLedgerEntries: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: 'ledger-corp-1',
							corporationId: '98000001',
							sourceType: 'corporation_wallet_journal',
							sourceSecondaryId: '1',
							refType: 'bounty_prizes',
							amount: '1000',
							division: 1,
							entryDate: new Date('2026-01-10T00:00:00.000Z'),
							isEss: false,
							essBankType: null,
							firstPartyId: null,
							secondPartyId: null,
							rawPayload: { tax: '0' },
						},
						{
							id: 'ledger-char-1',
							corporationId: '98000001',
							sourceType: 'character_wallet_journal',
							sourceSecondaryId: '7001',
							refType: 'bounty_prizes',
							amount: '500',
							division: null,
							entryDate: new Date('2026-01-11T00:00:00.000Z'),
							isEss: false,
							essBankType: null,
							firstPartyId: '7001',
							secondPartyId: null,
							rawPayload: { tax: '0' },
						},
					]),
				},
				taxRuleSets: {
					findMany: vi.fn().mockResolvedValue([]),
				},
			},
			transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
				const tx = {
					insert: vi.fn((table: unknown) => {
						if (table === taxPeriods) {
							return {
								values: vi.fn(() => ({
									onConflictDoUpdate: vi.fn(() => ({
										returning: vi.fn(() =>
											Promise.resolve([
												{
													id: 'period-1',
													corporationId: '98000001',
													periodStart: new Date('2026-01-01T00:00:00.000Z'),
													periodEnd: new Date('2026-01-31T00:00:00.000Z'),
													status: 'assessed',
													closedAt: new Date('2026-01-31T00:00:00.000Z'),
													createdAt: new Date('2026-01-31T00:00:00.000Z'),
													updatedAt: new Date('2026-01-31T00:00:00.000Z'),
												},
											])
										),
									})),
								})),
							}
						}

						if (table === taxAssessments) {
							return {
								values: vi.fn((value: any) => ({
									returning: vi.fn(() => {
										const payload = Array.isArray(value) ? value[0] : value
										const row = {
											id: `assessment-${insertedAssessments.length + 1}`,
											billId: null,
											billStatus: null,
											billStatusLastSyncedAt: null,
											approvedBy: null,
											approvedAt: null,
											createdAt: new Date('2026-01-31T00:00:00.000Z'),
											updatedAt: new Date('2026-01-31T00:00:00.000Z'),
											...payload,
										}
										insertedAssessments.push(row)
										return Promise.resolve([row])
									}),
								})),
							}
						}

						if (table === taxAssessmentLines) {
							return {
								values: vi.fn((values: any) => {
									if (Array.isArray(values)) {
										insertedAssessmentLines.push(...values)
									}
									return Promise.resolve()
								}),
							}
						}

						if (table === taxDiscrepancies) {
							return {
								values: vi.fn(() => Promise.resolve()),
							}
						}

						throw new Error('Unexpected insert table')
					}),
					update: vi.fn(() => ({
						set: vi.fn(() => ({
							where: vi.fn(() => ({
								returning: vi.fn(() => Promise.resolve([])),
							})),
						})),
					})),
					delete: vi.fn(() => ({
						where: vi.fn(() => Promise.resolve()),
					})),
					query: {
						taxAssessments: {
							findMany: vi.fn().mockResolvedValue([]),
						},
					},
				}
				return callback(tx)
			}),
		}

		getStubMock.mockReturnValue({
			getCorporationTaxMetadata: vi.fn().mockResolvedValue({
				corporationId: '98000001',
				inGameTaxRateBps: 1200,
				ceoId: null,
				memberCount: null,
				allianceId: null,
				updatedAt: null,
			}),
		})

		const service = new TaxAssessmentService(scopedDb as any, {} as DurableObjectNamespace)
		const result = await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: new Date('2026-01-01T00:00:00.000Z'),
			periodEnd: new Date('2026-01-31T00:00:00.000Z'),
		})

		const scopedKeys = insertedAssessments.map(
			(item) => `${item.assessmentScope as string}:${item.scopeId as string}`
		)
		expect(scopedKeys).toContain('corporation:98000001')
		expect(scopedKeys).toContain('division:1')
		expect(scopedKeys).toContain('character:7001')
		expect(insertedAssessmentLines.length).toBe(4)
		expect(result.lineCount).toBe(2)
	})
})
