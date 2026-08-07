import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
	taxAssessmentLines,
	taxAssessments,
	taxDiscrepancies,
	taxMemberContributionProjectionRollups,
	taxMemberSummaryVersions,
	taxPeriods,
} from '../../db/schema'
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
				taxCorporationExclusions: {
					findFirst: vi.fn().mockResolvedValue(null),
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
							firstPartyId: null,
							secondPartyId: null,
						},
					]),
				},
				taxRuleSets: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				taxRuleGroupAttachments: {
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
											taxDelta: '100',
											status: 'underpaid',
											inGameTaxRateBps: 1200,
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

	const createDiscrepancyAssessmentDb = () => {
		const insertedDiscrepancies: any[] = []
		const localDb = {
			query: {
				taxCorporationExclusions: {
					findFirst: vi.fn().mockResolvedValue(null),
				},
				taxLedgerEntries: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: 'ledger-1',
							corporationId: '98000001',
							sourceType: 'corporation_wallet_journal',
							sourceSecondaryId: '1',
							refType: 'bounty_prizes',
							amount: '1000',
							division: null,
							entryDate: new Date('2026-03-10T00:00:00.000Z'),
							firstPartyId: null,
							secondPartyId: null,
						},
					]),
				},
				taxRuleGroupAttachments: {
					findMany: vi.fn().mockResolvedValue([{ ruleGroupId: 'group-1' }]),
				},
				taxRuleSets: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: 'rule-5pct',
							ruleGroupId: 'group-1',
							name: 'Alliance Default Tax',
							priority: 100,
							isActive: true,
							appliesToRefType: null,
							taxRateBps: 500,
							createdBy: 'system:migration',
							createdAt: new Date('2026-01-01T00:00:00.000Z'),
							updatedAt: new Date('2026-01-01T00:00:00.000Z'),
						},
					]),
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
													periodStart: new Date('2026-03-01T00:00:00.000Z'),
													periodEnd: new Date('2026-03-31T00:00:00.000Z'),
													status: 'assessed',
													closedAt: new Date('2026-03-31T00:00:00.000Z'),
													createdAt: new Date('2026-03-31T00:00:00.000Z'),
													updatedAt: new Date('2026-03-31T00:00:00.000Z'),
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
									returning: vi.fn(() =>
										Promise.resolve([
											{
												id: 'assessment-1',
												billId: null,
												billStatus: null,
												billStatusLastSyncedAt: null,
												approvedBy: null,
												approvedAt: null,
												createdAt: new Date(),
												updatedAt: new Date(),
												...value,
											},
										])
									),
								})),
							}
						}
						if (table === taxAssessmentLines) {
							return {
								values: vi.fn(() => Promise.resolve()),
							}
						}
						if (table === taxDiscrepancies) {
							return {
								values: vi.fn((values: any[]) => {
									insertedDiscrepancies.push(...values)
									return Promise.resolve()
								}),
							}
						}
						throw new Error('Unexpected tx.insert table')
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
		return { localDb, insertedDiscrepancies }
	}

	it('computes deterministic period assessment and writes discrepancy metadata', async () => {
		const service = new TaxAssessmentService(mockDb, {} as DurableObjectNamespace)

		const result = await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: new Date('2026-01-01T00:00:00.000Z'),
			periodEnd: new Date('2026-01-31T00:00:00.000Z'),
		})

		expect(result.assessment.corporationId).toBe('98000001')
		expect(result.assessment.taxDue).toBe('100')
		expect(result.assessment.taxDelta).toBe('100')
		expect(result.assessment.status).toBe('underpaid')
		expect(result.lineCount).toBe(1)
		expect(result.discrepancyCount).toBe(0)
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
		expect(second.assessment.taxDelta).toBe(first.assessment.taxDelta)
		expect(second.assessment.status).toBe(first.assessment.status)
		expect(second.divisionSummaries).toEqual(first.divisionSummaries)
		expect(second.refTypeSummaries).toEqual(first.refTypeSummaries)
		expect(second.discrepancyCount).toBe(first.discrepancyCount)
	})

	it('does not create discrepancy records for open periods', async () => {
		const now = new Date('2026-03-23T00:00:00.000Z')
		vi.useFakeTimers()
		try {
			vi.setSystemTime(now)

			const { localDb, insertedDiscrepancies } = createDiscrepancyAssessmentDb()
			getStubMock.mockReturnValue({
				getMembers: vi.fn().mockResolvedValue([]),
				getCorporationTaxMetadata: vi.fn().mockResolvedValue({
					corporationId: '98000001',
					inGameTaxRateBps: 1200,
					ceoId: null,
					memberCount: null,
					allianceId: null,
					updatedAt: null,
				}),
			})

			const service = new TaxAssessmentService(localDb as any, {} as DurableObjectNamespace)
			const result = await service.runAssessmentForPeriod({
				corporationId: '98000001',
				periodStart: new Date('2026-03-01T00:00:00.000Z'),
				periodEnd: new Date('2026-03-20T00:00:00.000Z'),
			})

			expect(result.assessment.taxDue).toBe('50')
			expect(result.assessment.taxDelta).toBe('50')
			expect(result.discrepancyCount).toBe(0)
			expect(insertedDiscrepancies).toHaveLength(0)
		} finally {
			vi.useRealTimers()
		}
	})

	it('creates discrepancy records for closed periods when threshold is exceeded', async () => {
		const now = new Date('2026-03-23T00:00:00.000Z')
		vi.useFakeTimers()
		try {
			vi.setSystemTime(now)

			const { localDb, insertedDiscrepancies } = createDiscrepancyAssessmentDb()
			getStubMock.mockReturnValue({
				getMembers: vi.fn().mockResolvedValue([]),
				getCorporationTaxMetadata: vi.fn().mockResolvedValue({
					corporationId: '98000001',
					inGameTaxRateBps: 1200,
					ceoId: null,
					memberCount: null,
					allianceId: null,
					updatedAt: null,
				}),
			})

			const service = new TaxAssessmentService(localDb as any, {} as DurableObjectNamespace)
			const result = await service.runAssessmentForPeriod({
				corporationId: '98000001',
				periodStart: new Date('2026-02-01T00:00:00.000Z'),
				periodEnd: new Date('2026-02-28T23:59:59.999Z'),
			})

			expect(result.assessment.taxDue).toBe('50')
			expect(result.assessment.taxDelta).toBe('50')
			expect(result.discrepancyCount).toBe(1)
			expect(insertedDiscrepancies).toHaveLength(1)
			expect(insertedDiscrepancies[0]?.discrepancyType).toBe('tax_delta_threshold_exceeded')
		} finally {
			vi.useRealTimers()
		}
	})

	it('marks summary statuses as excluded when corporation has an exclusion override', async () => {
		mockDb.query.taxCorporationExclusions.findFirst.mockResolvedValue({
			corporationId: '98000001',
		})
		const service = new TaxAssessmentService(mockDb, {} as DurableObjectNamespace)

		const result = await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: new Date('2026-01-01T00:00:00.000Z'),
			periodEnd: new Date('2026-01-31T00:00:00.000Z'),
		})

		expect(result.divisionSummaries[0]?.status).toBe('excluded')
		expect(result.refTypeSummaries[0]?.status).toBe('excluded')
	})

	it('applies higher-priority active rule when multiple rules match', async () => {
		const insertedAssessmentLines: any[] = []
		const localDb = {
			query: {
				taxCorporationExclusions: {
					findFirst: vi.fn().mockResolvedValue(null),
				},
				taxLedgerEntries: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: 'ledger-1',
							corporationId: '98000001',
							refType: 'bounty_prizes',
							amount: '1000',
							division: null,
							entryDate: new Date('2026-01-10T00:00:00.000Z'),
							firstPartyId: null,
							secondPartyId: null,
						},
					]),
				},
				taxRuleGroupAttachments: {
					findMany: vi.fn().mockResolvedValue([{ ruleGroupId: 'group-1' }]),
				},
				taxRuleSets: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: 'rule-high',
							ruleGroupId: 'group-1',
							name: 'High Priority',
							priority: 200,
							isActive: true,
							appliesToRefType: 'bounty_prizes',
							taxRateBps: 2000,
							createdBy: 'admin-1',
							createdAt: new Date('2026-01-05T00:00:00.000Z'),
							updatedAt: new Date('2026-01-06T00:00:00.000Z'),
						},
						{
							id: 'rule-low',
							ruleGroupId: 'group-1',
							name: 'Low Priority',
							priority: 100,
							isActive: true,
							appliesToRefType: 'bounty_prizes',
							taxRateBps: 500,
							createdBy: 'admin-1',
							createdAt: new Date('2026-01-04T00:00:00.000Z'),
							updatedAt: new Date('2026-01-04T00:00:00.000Z'),
						},
					]),
				},
			},
			insert: vi.fn(() => {
				throw new Error('Unexpected db.insert table')
			}),
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
													createdAt: new Date(),
													updatedAt: new Date(),
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
									returning: vi.fn(() =>
										Promise.resolve([
											{
												id: 'assessment-1',
												billId: null,
												billStatus: null,
												billStatusLastSyncedAt: null,
												approvedBy: null,
												approvedAt: null,
												createdAt: new Date(),
												updatedAt: new Date(),
												...value,
											},
										])
									),
								})),
							}
						}
						if (table === taxAssessmentLines) {
							return {
								values: vi.fn((values: any) => {
									insertedAssessmentLines.push(...(values as any[]))
									return Promise.resolve()
								}),
							}
						}
						if (table === taxDiscrepancies) {
							return { values: vi.fn(() => Promise.resolve()) }
						}
						throw new Error('Unexpected tx.insert table')
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

		const service = new TaxAssessmentService(localDb as any, {} as DurableObjectNamespace)
		const result = await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: new Date('2026-01-01T00:00:00.000Z'),
			periodEnd: new Date('2026-01-31T00:00:00.000Z'),
		})

		expect(result.assessment.taxDue).toBe('200')
		expect(insertedAssessmentLines[0]?.taxRateBps).toBe(2000)
	})

	it('ignores inactive higher-priority rule by relying on active-only rule query', async () => {
		const insertedAssessmentLines: any[] = []
		const findManyMock = vi.fn().mockResolvedValue([
			{
				id: 'rule-low-active',
				ruleGroupId: 'group-1',
				name: 'Low Priority Active',
				priority: 100,
				isActive: true,
				appliesToRefType: 'bounty_prizes',
				taxRateBps: 500,
				createdBy: 'admin-1',
				createdAt: new Date('2026-01-04T00:00:00.000Z'),
				updatedAt: new Date('2026-01-04T00:00:00.000Z'),
			},
		])
		const localDb = {
			query: {
				taxCorporationExclusions: {
					findFirst: vi.fn().mockResolvedValue(null),
				},
				taxLedgerEntries: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: 'ledger-1',
							corporationId: '98000001',
							refType: 'bounty_prizes',
							amount: '1000',
							division: null,
							entryDate: new Date('2026-01-10T00:00:00.000Z'),
							firstPartyId: null,
							secondPartyId: null,
						},
					]),
				},
				taxRuleGroupAttachments: {
					findMany: vi.fn().mockResolvedValue([{ ruleGroupId: 'group-1' }]),
				},
				taxRuleSets: {
					findMany: findManyMock,
				},
			},
			insert: vi.fn(() => {
				throw new Error('Unexpected db.insert table')
			}),
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
													createdAt: new Date(),
													updatedAt: new Date(),
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
									returning: vi.fn(() =>
										Promise.resolve([
											{
												id: 'assessment-1',
												billId: null,
												billStatus: null,
												billStatusLastSyncedAt: null,
												approvedBy: null,
												approvedAt: null,
												createdAt: new Date(),
												updatedAt: new Date(),
												...value,
											},
										])
									),
								})),
							}
						}
						if (table === taxAssessmentLines) {
							return {
								values: vi.fn((values: any) => {
									insertedAssessmentLines.push(...(values as any[]))
									return Promise.resolve()
								}),
							}
						}
						if (table === taxDiscrepancies) {
							return { values: vi.fn(() => Promise.resolve()) }
						}
						throw new Error('Unexpected tx.insert table')
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

		const service = new TaxAssessmentService(localDb as any, {} as DurableObjectNamespace)
		const result = await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: new Date('2026-01-01T00:00:00.000Z'),
			periodEnd: new Date('2026-01-31T00:00:00.000Z'),
		})

		expect(result.assessment.taxDue).toBe('50')
		expect(insertedAssessmentLines[0]?.taxRateBps).toBe(500)
		expect(findManyMock).toHaveBeenCalledTimes(1)
		expect(findManyMock.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				where: expect.anything(),
				orderBy: expect.any(Array),
			})
		)
	})

	it('treats a 0% rule as exempt income', async () => {
		const insertedAssessmentLines: any[] = []
		const localDb = {
			query: {
				taxCorporationExclusions: {
					findFirst: vi.fn().mockResolvedValue(null),
				},
				taxLedgerEntries: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: 'ledger-1',
							corporationId: '98000001',
							refType: 'bounty_prizes',
							amount: '1000',
							division: null,
							entryDate: new Date('2026-01-10T00:00:00.000Z'),
							firstPartyId: null,
							secondPartyId: null,
						},
					]),
				},
				taxRuleGroupAttachments: {
					findMany: vi.fn().mockResolvedValue([{ ruleGroupId: 'group-1' }]),
				},
				taxRuleSets: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: 'rule-exempt',
							ruleGroupId: 'group-1',
							name: 'Exempt Rule!!! 2026 with REALLY REALLY REALLY LONG NAME ***',
							priority: 200,
							isActive: true,
							appliesToRefType: 'bounty_prizes',
							taxRateBps: 0,
							createdBy: 'admin-1',
							createdAt: new Date('2026-01-05T00:00:00.000Z'),
							updatedAt: new Date('2026-01-06T00:00:00.000Z'),
						},
					]),
				},
			},
			insert: vi.fn(() => {
				throw new Error('Unexpected db.insert table')
			}),
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
													createdAt: new Date(),
													updatedAt: new Date(),
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
									returning: vi.fn(() =>
										Promise.resolve([
											{
												id: 'assessment-1',
												billId: null,
												billStatus: null,
												billStatusLastSyncedAt: null,
												approvedBy: null,
												approvedAt: null,
												createdAt: new Date(),
												updatedAt: new Date(),
												...value,
											},
										])
									),
								})),
							}
						}
						if (table === taxAssessmentLines) {
							return {
								values: vi.fn((values: any) => {
									insertedAssessmentLines.push(...(values as any[]))
									return Promise.resolve()
								}),
							}
						}
						if (table === taxDiscrepancies) {
							return { values: vi.fn(() => Promise.resolve()) }
						}
						throw new Error('Unexpected tx.insert table')
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

		const service = new TaxAssessmentService(localDb as any, {} as DurableObjectNamespace)
		const result = await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: new Date('2026-01-01T00:00:00.000Z'),
			periodEnd: new Date('2026-01-31T00:00:00.000Z'),
		})

		expect(result.assessment.taxableIncome).toBe('0')
		expect(result.assessment.nonTaxableIncome).toBe('1000')
		expect(result.assessment.taxDue).toBe('0')
		expect(insertedAssessmentLines[0]?.taxRateBps).toBe(0)
		expect(insertedAssessmentLines[0]?.classification).toBe(
			'rule_exempt:exempt_rule_2026_with_really_really_really_long'
		)
	})

	it('creates scoped assessments for division and character rollups', async () => {
		const insertedAssessments: any[] = []
		const insertedAssessmentLines: any[] = []

		const scopedDb = {
			query: {
				taxCorporationExclusions: {
					findFirst: vi.fn().mockResolvedValue(null),
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
							firstPartyId: null,
							secondPartyId: null,
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
							firstPartyId: '7001',
							secondPartyId: null,
						},
					]),
				},
				taxRuleSets: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				taxRuleGroupAttachments: {
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

	it('rebuildFinalizedRollupsForPeriod rejects open periods', async () => {
		const service = new TaxAssessmentService(mockDb, {} as DurableObjectNamespace)
		const now = new Date()
		const openStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
		const openEnd = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
		)

		await expect(
			service.rebuildFinalizedRollupsForPeriod({
				corporationId: '98000001',
				periodStart: openStart,
				periodEnd: openEnd,
			})
		).rejects.toThrow('Finalized rollup rebuild requires a closed period')
	})

	it('rebuildFinalizedRollupsForPeriod delegates to runAssessmentForPeriod for closed periods', async () => {
		const service = new TaxAssessmentService(mockDb, {} as DurableObjectNamespace)
		const closedStart = new Date('2026-01-01T00:00:00.000Z')
		const closedEnd = new Date('2026-01-31T23:59:59.999Z')
		const expected = {
			assessment: { id: 'assessment-closed-1' },
			period: { id: 'period-closed-1' },
			lineCount: 0,
			discrepancyCount: 0,
			divisionSummaries: [],
			refTypeSummaries: [],
		} as any
		const runAssessmentSpy = vi.spyOn(service, 'runAssessmentForPeriod').mockResolvedValue(expected)

		const result = await service.rebuildFinalizedRollupsForPeriod({
			corporationId: '98000001',
			periodStart: closedStart,
			periodEnd: closedEnd,
		})

		expect(result).toBe(expected)
		expect(runAssessmentSpy).toHaveBeenCalledWith({
			corporationId: '98000001',
			periodStart: closedStart,
			periodEnd: closedEnd,
			includeCharacterWallets: false,
		})
	})

	it('runs without db.transaction when direct write methods are available', async () => {
		const periodStart = new Date('2026-01-01T00:00:00.000Z')
		const periodEnd = new Date('2026-01-31T23:59:59.999Z')
		const now = new Date('2026-02-01T00:00:00.000Z')

		const directDb = {
			query: {
				taxCorporationExclusions: {
					findFirst: vi.fn().mockResolvedValue(null),
				},
				taxLedgerEntries: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				taxRuleGroupAttachments: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				taxRuleSets: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				taxAssessments: {
					findMany: vi.fn().mockResolvedValue([]),
				},
			},
			insert: vi.fn((table: unknown) => {
				if (table === taxPeriods) {
					return {
						values: vi.fn(() => ({
							onConflictDoUpdate: vi.fn(() => ({
								returning: vi.fn(() =>
									Promise.resolve([
										{
											id: 'period-direct-1',
											corporationId: '98000001',
											periodStart,
											periodEnd,
											status: 'assessed',
											closedAt: now,
											createdAt: now,
											updatedAt: now,
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
							returning: vi.fn(() =>
								Promise.resolve([
									{
										id: 'assessment-direct-1',
										billId: null,
										billStatus: null,
										billStatusLastSyncedAt: null,
										approvedBy: null,
										approvedAt: null,
										createdAt: now,
										updatedAt: now,
										...value,
									},
								])
							),
						})),
					}
				}
				if (table === taxAssessmentLines || table === taxDiscrepancies) {
					return {
						values: vi.fn(() => Promise.resolve()),
					}
				}
				throw new Error('Unexpected directDb.insert table')
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
		}

		const service = new TaxAssessmentService(directDb as any, {} as DurableObjectNamespace)
		const result = await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart,
			periodEnd,
		})

		expect(result.assessment.id).toBe('assessment-direct-1')
		expect(result.lineCount).toBe(0)
	})

	it('applies projection rollup delta idempotently across repeated open-period runs', async () => {
		const projectionRowsByKey = new Map<string, any>()
		const summaryVersionWrites: any[] = []
		const openStart = new Date('2026-03-01T00:00:00.000Z')
		const openEnd = new Date('2026-03-20T00:00:00.000Z')
		const stalePeriodStart = new Date('2026-03-12T00:00:00.000Z')
		const now = new Date('2026-03-20T00:00:00.000Z')

		vi.useFakeTimers()
		vi.setSystemTime(now)
		const originalDateNow = Date.now
		Date.now = () => now.getTime()
		projectionRowsByKey.set(
			[
				'98000001',
				stalePeriodStart.toISOString(),
				openEnd.toISOString(),
				new Date('2026-03-10T00:00:00.000Z').toISOString(),
				'7001',
				'bounty_prizes',
			].join(':'),
			{
				corporationId: '98000001',
				periodStart: stalePeriodStart,
				periodEnd: openEnd,
				rollupDate: new Date('2026-03-10T00:00:00.000Z'),
				characterId: '7001',
				refType: 'bounty_prizes',
				contributionIncome: '9999',
				taxableContributionIncome: '9999',
				assessmentCount: 1,
				sourceRowCount: 1,
				lastAssessmentAt: openEnd,
				lastLedgerEntryDate: new Date('2026-03-10T00:00:00.000Z'),
				updatedAt: now,
			}
		)

		const projectionDb = {
			query: {
				taxCorporationExclusions: {
					findFirst: vi.fn().mockResolvedValue(null),
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
							entryDate: new Date('2026-03-10T00:00:00.000Z'),
							firstPartyId: '7001',
							secondPartyId: null,
						},
					]),
				},
				taxRuleSets: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				taxRuleGroupAttachments: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				taxMemberSummaryVersions: {
					findFirst: vi.fn().mockResolvedValue({
						corporationId: '98000001',
						projectionVersion: 0,
						finalizedVersion: 0,
					}),
				},
				taxMemberContributionProjectionRollups: {
					findMany: vi
						.fn()
						.mockImplementation(() => Promise.resolve(Array.from(projectionRowsByKey.values()))),
				},
				taxMemberContributionFinalizedRollups: {
					findMany: vi.fn().mockResolvedValue([]),
				},
			},
			insert: vi.fn((table: unknown) => {
				if (table === taxMemberSummaryVersions) {
					return {
						values: vi.fn((values: any) => ({
							onConflictDoUpdate: vi.fn(() => {
								summaryVersionWrites.push(values)
								return Promise.resolve()
							}),
						})),
					}
				}
				throw new Error('Unexpected db.insert table')
			}),
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
													id: 'period-open-1',
													corporationId: '98000001',
													periodStart: openStart,
													periodEnd: openEnd,
													status: 'assessed',
													closedAt: openEnd,
													createdAt: now,
													updatedAt: now,
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
									returning: vi.fn(() =>
										Promise.resolve([
											{
												id: 'assessment-open-1',
												billId: null,
												billStatus: null,
												billStatusLastSyncedAt: null,
												approvedBy: null,
												approvedAt: null,
												createdAt: now,
												updatedAt: now,
												...value,
											},
										])
									),
								})),
							}
						}
						if (table === taxAssessmentLines || table === taxDiscrepancies) {
							return {
								values: vi.fn(() => Promise.resolve()),
							}
						}
						if (table === taxMemberContributionProjectionRollups) {
							return {
								values: vi.fn((values: any[]) => ({
									onConflictDoUpdate: vi.fn(() => {
										for (const row of values) {
											const key = [
												row.corporationId,
												row.periodStart.toISOString(),
												row.periodEnd.toISOString(),
												row.rollupDate.toISOString(),
												row.characterId,
												row.refType,
											].join(':')
											projectionRowsByKey.set(key, row)
										}
										return Promise.resolve()
									}),
								})),
							}
						}
						throw new Error('Unexpected tx.insert table')
					}),
					update: vi.fn(() => ({
						set: vi.fn(() => ({
							where: vi.fn(() => ({
								returning: vi.fn(() => Promise.resolve([])),
							})),
						})),
					})),
					delete: vi.fn((table: unknown) => ({
						where: vi.fn(() => {
							if (table === taxMemberContributionProjectionRollups) {
								for (const [key, row] of projectionRowsByKey.entries()) {
									if (
										row.corporationId === '98000001' &&
										row.periodEnd.toISOString() === openEnd.toISOString() &&
										row.periodStart.toISOString() !== openStart.toISOString()
									) {
										projectionRowsByKey.delete(key)
									}
								}
							}
							return Promise.resolve()
						}),
					})),
					query: {
						taxAssessments: {
							findMany: vi.fn().mockResolvedValue([]),
						},
						taxMemberContributionProjectionRollups: {
							findMany: vi
								.fn()
								.mockImplementation(() =>
									Promise.resolve(Array.from(projectionRowsByKey.values()))
								),
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
			getMembers: vi.fn().mockResolvedValue([
				{
					characterId: '7001',
					corporationId: '98000001',
				},
			]),
		})

		const service = new TaxAssessmentService(projectionDb as any, {} as DurableObjectNamespace)
		await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: openStart,
			periodEnd: openEnd,
		})
		await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: openStart,
			periodEnd: openEnd,
		})

		expect(projectionRowsByKey.size).toBe(1)
		const [stored] = Array.from(projectionRowsByKey.values())
		expect(stored.characterId).toBe('7001')
		expect(stored.refType).toBe('bounty_prizes')
		expect(stored.contributionIncome).toBe('1000')
		expect(stored.taxableContributionIncome).toBe('0')
		expect(stored.periodStart.toISOString()).toBe(openStart.toISOString())
		expect(summaryVersionWrites.length).toBe(2)

		Date.now = originalDateNow
		vi.useRealTimers()
	})

	it('stores member-summary taxable contribution as tax owed for a 5% rule', async () => {
		const projectionRowsByKey = new Map<string, any>()
		const openStart = new Date('2026-03-01T00:00:00.000Z')
		const openEnd = new Date('2026-03-20T00:00:00.000Z')
		const now = new Date('2026-03-20T00:00:00.000Z')

		vi.useFakeTimers()
		vi.setSystemTime(now)
		const originalDateNow = Date.now
		Date.now = () => now.getTime()

		const projectionDb = {
			query: {
				taxCorporationExclusions: {
					findFirst: vi.fn().mockResolvedValue(null),
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
							entryDate: new Date('2026-03-10T00:00:00.000Z'),
							firstPartyId: '7001',
							secondPartyId: null,
						},
					]),
				},
				taxRuleGroupAttachments: {
					findMany: vi.fn().mockResolvedValue([{ ruleGroupId: 'group-1' }]),
				},
				taxRuleSets: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: 'rule-5pct',
							ruleGroupId: 'group-1',
							name: 'Alliance Default Tax',
							priority: 100,
							isActive: true,
							appliesToRefType: null,
							taxRateBps: 500,
							createdBy: 'system:migration',
							createdAt: new Date('2026-01-01T00:00:00.000Z'),
							updatedAt: new Date('2026-01-01T00:00:00.000Z'),
						},
					]),
				},
				taxMemberSummaryVersions: {
					findFirst: vi.fn().mockResolvedValue({
						corporationId: '98000001',
						projectionVersion: 0,
						finalizedVersion: 0,
					}),
				},
				taxMemberContributionProjectionRollups: {
					findMany: vi
						.fn()
						.mockImplementation(() => Promise.resolve(Array.from(projectionRowsByKey.values()))),
				},
				taxMemberContributionFinalizedRollups: {
					findMany: vi.fn().mockResolvedValue([]),
				},
			},
			insert: vi.fn((table: unknown) => {
				if (table === taxMemberSummaryVersions) {
					return {
						values: vi.fn(() => ({
							onConflictDoUpdate: vi.fn(() => Promise.resolve()),
						})),
					}
				}
				throw new Error('Unexpected db.insert table')
			}),
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
													id: 'period-open-1',
													corporationId: '98000001',
													periodStart: openStart,
													periodEnd: openEnd,
													status: 'assessed',
													closedAt: openEnd,
													createdAt: now,
													updatedAt: now,
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
									returning: vi.fn(() =>
										Promise.resolve([
											{
												id: 'assessment-open-1',
												billId: null,
												billStatus: null,
												billStatusLastSyncedAt: null,
												approvedBy: null,
												approvedAt: null,
												createdAt: now,
												updatedAt: now,
												...value,
											},
										])
									),
								})),
							}
						}
						if (table === taxAssessmentLines || table === taxDiscrepancies) {
							return {
								values: vi.fn(() => Promise.resolve()),
							}
						}
						if (table === taxMemberContributionProjectionRollups) {
							return {
								values: vi.fn((values: any[]) => ({
									onConflictDoUpdate: vi.fn(() => {
										for (const row of values) {
											const key = [
												row.corporationId,
												row.periodStart.toISOString(),
												row.periodEnd.toISOString(),
												row.rollupDate.toISOString(),
												row.characterId,
												row.refType,
											].join(':')
											projectionRowsByKey.set(key, row)
										}
										return Promise.resolve()
									}),
								})),
							}
						}
						throw new Error('Unexpected tx.insert table')
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
						taxMemberContributionProjectionRollups: {
							findMany: vi
								.fn()
								.mockImplementation(() =>
									Promise.resolve(Array.from(projectionRowsByKey.values()))
								),
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
			getMembers: vi.fn().mockResolvedValue([
				{
					characterId: '7001',
					corporationId: '98000001',
				},
			]),
		})

		const service = new TaxAssessmentService(projectionDb as any, {} as DurableObjectNamespace)
		await service.runAssessmentForPeriod({
			corporationId: '98000001',
			periodStart: openStart,
			periodEnd: openEnd,
		})

		expect(projectionRowsByKey.size).toBe(1)
		const [stored] = Array.from(projectionRowsByKey.values())
		expect(stored.characterId).toBe('7001')
		expect(stored.refType).toBe('bounty_prizes')
		expect(stored.contributionIncome).toBe('1000')
		expect(stored.taxableContributionIncome).toBe('50')

		Date.now = originalDateNow
		vi.useRealTimers()
	})
})
