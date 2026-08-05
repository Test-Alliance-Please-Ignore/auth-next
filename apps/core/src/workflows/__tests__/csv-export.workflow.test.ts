import { describe, expect, it, vi } from 'vitest'

import { CsvExportWorkflow } from '../csv-export.workflow'

import type { WorkflowStep } from 'cloudflare:workers'

const writeExportMock = vi.fn()

vi.mock('@repo/do-utils', () => ({ getStub: vi.fn() }))

vi.mock('../../routes/moon-scan', () => ({
	buildVerifiedMoonsExportFileName: vi.fn(),
	buildVerifiedMoonsExportKey: vi.fn(),
	getVerifiedMoonsExportBucket: vi.fn(),
	buildVerifiedMoonSummaryRecords: vi.fn(),
	writeVerifiedMoonsExportToBucket: vi.fn(),
}))

vi.mock('../../routes/srp', () => ({
	buildSrpPaidRequestsExportFileName: vi.fn(),
	buildSrpPaidRequestsExportKey: vi.fn(),
	buildSrpWalletHistoryExportFileName: vi.fn(),
	buildSrpWalletHistoryExportKey: vi.fn(),
	getSrpExportBucket: vi.fn(),
	parseSrpCsvExportDateRange: vi.fn(),
	writeSrpPaidRequestsExportToBucket: vi.fn(),
	writeSrpWalletHistoryExportToBucket: vi.fn(),
}))

vi.mock('../../lib/structure-assets-debug', () => ({
	buildStructureAssetsDebugExportKey: vi.fn(),
	buildStructureAssetsDebugFileName: vi.fn(),
	enrichStructureAssetsDebugTypeNames: vi.fn(),
	getStructureAssetsDebugBucket: vi.fn(),
	getStructureAssetLocationLabel: vi.fn(),
	writeStructureAssetsDebugArtifact: vi.fn(),
}))

vi.mock('cloudflare:workers', () => ({
	WorkflowEntrypoint: class {
		protected readonly env: unknown
		constructor(_ctx: unknown, env: unknown) {
			this.env = env
		}
	},
}))

vi.mock('../../lib/fleet-participation-export', () => ({
	buildFleetParticipationExportFileName: () => 'fleet-participation.csv',
	writeFleetParticipationExportToBucket: (...args: unknown[]) => writeExportMock(...args),
}))

function createStep(): WorkflowStep {
	return {
		do: vi.fn(async (_name: string, optionsOrHandler: unknown, maybeHandler?: () => unknown) => {
			const handler =
				typeof optionsOrHandler === 'function'
					? optionsOrHandler
					: maybeHandler
			if (!handler) throw new Error('missing workflow step handler')
			return await handler()
		}),
	} as unknown as WorkflowStep
}

describe('CsvExportWorkflow fleet participation export', () => {
	it('writes a fleet participation artifact through the existing workflow step', async () => {
		writeExportMock.mockResolvedValue({
			rowCount: 2,
			expiresAt: '2026-08-04T01:00:00.000Z',
		})
		const workflow = new CsvExportWorkflow({} as ExecutionContext, {} as never)

		const result = await workflow.run(
			{
				payload: {
					kind: 'fleet-corporation-participation',
					userId: 'user-1',
					corporationId: 'corp-1',
					dateFrom: '2026-08-01T00:00:00.000Z',
					dateTo: '2026-09-01T00:00:00.000Z',
				},
				instanceId: 'workflow-1',
				timestamp: new Date('2026-08-04T00:00:00.000Z'),
			} as never,
			createStep()
		)

		expect(result).toMatchObject({
			status: 'completed',
			kind: 'fleet-corporation-participation',
			corporationId: 'corp-1',
			rowCount: 2,
		})
		expect(writeExportMock).toHaveBeenCalledWith({
			env: {},
			exportId: 'workflow-1',
			corporationId: 'corp-1',
			dateFrom: '2026-08-01T00:00:00.000Z',
			dateTo: '2026-09-01T00:00:00.000Z',
			fileName: 'fleet-participation.csv',
		})
	})
})
