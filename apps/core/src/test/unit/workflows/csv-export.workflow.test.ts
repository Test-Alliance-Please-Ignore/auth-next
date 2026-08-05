import { describe, expect, it, vi } from 'vitest'

import { CsvExportWorkflow } from '../../../workflows/csv-export.workflow'

import type { WorkflowStep } from 'cloudflare:workers'

const getStubMock = vi.fn()
const moonWriteMock = vi.fn()
const srpPaidWriteMock = vi.fn()
const srpWalletWriteMock = vi.fn()
const fleetWriteMock = vi.fn()

vi.mock('cloudflare:workers', () => {
	class WorkflowEntrypoint<Env = unknown, Params = unknown> {
		protected readonly ctx: unknown
		protected readonly env: Env

		constructor(ctx: unknown, env: Env) {
			this.ctx = ctx
			this.env = env
		}

		// eslint-disable-next-line @typescript-eslint/require-await
		async run(_event: unknown, _step: unknown): Promise<Params> {
			throw new Error('WorkflowEntrypoint.run is not implemented in unit-test shim')
		}
	}

	return {
		WorkflowEntrypoint,
		WorkflowEvent: class WorkflowEvent {},
		WorkflowStep: class WorkflowStep {},
	}
})

vi.mock('@repo/do-utils', () => ({
	getStub: (...args: unknown[]) => getStubMock(...args),
}))

vi.mock('../../../routes/moon-scan', () => ({
	buildVerifiedMoonsExportFileName: () => 'verified-moons.csv',
	buildVerifiedMoonsExportKey: () => 'moon-export-key',
	getVerifiedMoonsExportBucket: () => ({ name: 'MOON_SCAN_EXPORTS' }),
	buildVerifiedMoonSummaryRecords: vi.fn(),
	writeVerifiedMoonsExportToBucket: (...args: unknown[]) => moonWriteMock(...args),
}))

vi.mock('../../../routes/srp', () => ({
	buildSrpPaidRequestsExportFileName: () => 'srp-paid.csv',
	buildSrpPaidRequestsExportKey: () => 'srp-paid-key',
	buildSrpWalletHistoryExportFileName: () => 'srp-wallet.csv',
	buildSrpWalletHistoryExportKey: () => 'srp-wallet-key',
	getSrpExportBucket: () => ({ name: 'SRP_EXPORTS' }),
	parseSrpCsvExportDateRange: () => ({
		dateFrom: '2026-07-01T00:00:00.000Z',
		dateTo: '2026-07-31T23:59:59.999Z',
		startDate: new Date('2026-07-01T00:00:00.000Z'),
		endDate: new Date('2026-07-31T23:59:59.999Z'),
	}),
	writeSrpPaidRequestsExportToBucket: (...args: unknown[]) => srpPaidWriteMock(...args),
	writeSrpWalletHistoryExportToBucket: (...args: unknown[]) => srpWalletWriteMock(...args),
}))

vi.mock('../../../lib/fleet-participation-export', () => ({
	buildFleetParticipationExportFileName: () => 'fleet-participation.csv',
	writeFleetParticipationExportToBucket: (...args: unknown[]) => fleetWriteMock(...args),
}))

function createStep() {
	const doMock = vi.fn(
		async (_name: string, optionsOrHandler: unknown, maybeHandler?: () => unknown) => {
			const handler =
				typeof optionsOrHandler === 'function'
					? (optionsOrHandler as () => unknown)
					: (maybeHandler as () => unknown)
			return await handler()
		}
	)

	return {
		step: { do: doMock } as unknown as WorkflowStep,
	}
}

describe('CsvExportWorkflow structure assets debug export', () => {
	it('writes the debug artifact to R2 using the workflow job', async () => {
		const bucketPut = vi.fn().mockResolvedValue(undefined)
		const bucket = {
			put: bucketPut,
		}
		const corpData = {
			fetchAssets: vi.fn().mockResolvedValue({ assetsCount: 2 }),
			searchAssets: vi.fn().mockResolvedValue([
				{
					itemId: 'item-1',
					typeId: '35832',
					quantity: 1,
					isSingleton: true,
					locationId: 'structure-1',
					locationType: 'item',
					locationFlag: 'ServiceSlot0',
					updatedAt: new Date('2026-07-13T00:00:00.000Z'),
				},
			]),
		}
		const universe = {
			resolveTypeNamesByIds: vi.fn().mockResolvedValue({
				'35832': { typeName: 'Astrahus' },
			}),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (
				binding &&
				typeof binding === 'object' &&
				'name' in binding &&
				binding.name === 'EVE_CORPORATION_DATA'
			) {
				return corpData
			}
			if (
				binding &&
				typeof binding === 'object' &&
				'name' in binding &&
				binding.name === 'UNIVERSE'
			) {
				return universe
			}
			if (
				binding &&
				typeof binding === 'object' &&
				'name' in binding &&
				binding.name === 'STRUCTURE_ASSETS_DEBUG_EXPORTS'
			) {
				return bucket
			}
			return {}
		})

		const workflow = new CsvExportWorkflow(
			{} as ExecutionContext,
			{
				EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
				UNIVERSE: { name: 'UNIVERSE' },
				STRUCTURE_ASSETS_DEBUG_EXPORTS: bucket,
			} as never
		)
		const { step } = createStep()

		const result = await workflow.run(
			{
				payload: {
					kind: 'structure-assets-debug',
					userId: 'user-1',
					corporationId: 'corp-1',
					corporationName: 'Test Corp',
					structureId: 'structure-1',
					structureName: 'Structure One',
				},
				instanceId: 'workflow-1',
				timestamp: new Date('2026-07-13T00:00:00.000Z'),
			} as never,
			step
		)

		expect(result).toMatchObject({
			status: 'completed',
			workflowInstanceId: 'workflow-1',
			kind: 'structure-assets-debug',
			exportId: 'workflow-1',
			rowCount: 1,
		})
		expect(corpData.fetchAssets).toHaveBeenCalledWith('corp-1', true)
		expect(corpData.searchAssets).toHaveBeenCalledWith('corp-1', {
			locationId: 'structure-1',
			locationType: 'item',
		})
		expect(universe.resolveTypeNamesByIds).toHaveBeenCalledWith(['35832'])
		expect(bucketPut).toHaveBeenCalledTimes(1)

		const [exportKey, body, options] = bucketPut.mock.calls[0] as [
			string,
			string,
			{ customMetadata?: { fileName?: string; expiresAt?: string } },
		]
		expect(exportKey).toBe('structure-assets-debug/workflow-1.json')
		expect(options.customMetadata?.fileName).toBe('structure-assets-debug-workflow.json')
		expect(options.customMetadata?.expiresAt).toBeTruthy()
		const artifact = JSON.parse(body) as {
			corporationId: string
			structureId: string
			itemCount: number
			items: Array<{ typeName: string | null }>
		}
		expect(artifact).toMatchObject({
			corporationId: 'corp-1',
			structureId: 'structure-1',
			itemCount: 1,
		})
		expect(artifact.items[0]?.typeName).toBe('Astrahus')
	})
})

describe('CsvExportWorkflow fleet participation export', () => {
	it('dispatches the bounded fleet export writer and preserves corporation metadata', async () => {
		fleetWriteMock.mockResolvedValue({
			rowCount: 12,
			expiresAt: '2026-07-13T01:00:00.000Z',
		})
		const workflow = new CsvExportWorkflow({} as ExecutionContext, {} as never)
		const { step } = createStep()

		const result = await workflow.run(
			{
				payload: {
					kind: 'fleet-corporation-participation',
					userId: 'user-1',
					corporationId: 'corp-1',
					dateFrom: '2026-07-01T00:00:00.000Z',
					dateTo: '2026-08-01T00:00:00.000Z',
				},
				instanceId: 'workflow-fleet-1',
				timestamp: new Date('2026-07-13T00:00:00.000Z'),
			} as never,
			step
		)

		expect(result).toMatchObject({
			status: 'completed',
			kind: 'fleet-corporation-participation',
			workflowInstanceId: 'workflow-fleet-1',
			corporationId: 'corp-1',
			rowCount: 12,
		})
		expect(fleetWriteMock).toHaveBeenCalledWith({
			env: {},
			exportId: 'workflow-fleet-1',
			corporationId: 'corp-1',
			dateFrom: '2026-07-01T00:00:00.000Z',
			dateTo: '2026-08-01T00:00:00.000Z',
			fileName: 'fleet-participation.csv',
		})
	})
})
