import { describe, expect, it, vi } from 'vitest'

import { TaxLedgerService } from '../tax-ledger.service'

const getStubMock = vi.fn()

vi.mock('@repo/do-utils', () => ({
	getStub: (...args: unknown[]) => getStubMock(...args),
}))

describe('TaxLedgerService ESS quality signals', () => {
	it('reports duplicate and missing ESS source records from an ingestion batch', () => {
		const service = new TaxLedgerService(
			{} as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)

		const result = (service as any).summarizeEssQualitySignals([
			{ isEss: true, sourceKey: 'ess-1', essBankType: 'main' },
			{ isEss: true, sourceKey: 'ess-1', essBankType: 'main' },
			{ isEss: true, sourceKey: 'ess-2', essBankType: null },
			{ isEss: true, sourceKey: 'ess-2', essBankType: null },
			{ isEss: false, sourceKey: 'non-ess-1', essBankType: null },
		])

		expect(result).toEqual({
			duplicateRecordCount: 2,
			duplicateSourceKeys: ['ess-1', 'ess-2'],
			missingRecordCount: 2,
			missingSourceKeys: ['ess-2'],
		})
	})

	it('returns zero signals when ESS rows are clean or absent', () => {
		const service = new TaxLedgerService(
			{} as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)

		const result = (service as any).summarizeEssQualitySignals([
			{ isEss: true, sourceKey: 'ess-clean', essBankType: 'reserve' },
			{ isEss: false, sourceKey: 'non-ess-1', essBankType: null },
		])

		expect(result).toEqual({
			duplicateRecordCount: 0,
			duplicateSourceKeys: [],
			missingRecordCount: 0,
			missingSourceKeys: [],
		})
	})
})
