import { describe, expect, it, vi } from 'vitest'

import { EveCorporationSyncWorkflow } from '../../../workflows/sync-workflow'

import type { WorkflowStep } from 'cloudflare:workers'

const getStubMock = vi.fn()
const syncAssetsMock = vi.fn()
const fetchStructuresMock = vi.fn()
const selectDirectorMock = vi.fn()
const verifyAllDirectorsHealthMock = vi.fn()
const reconcileDirectorsFromCorporationRolesMock = vi.fn()
const recordDirectorSuccessMock = vi.fn()
const updateSyncTimestampsMock = vi.fn()
const updateCoreLastSyncMock = vi.fn()
const replayTaxProjectionRetryIntentMock = vi.fn()
const clearTaxProjectionRetryIntentMock = vi.fn()
const recordTaxProjectionRetryIntentMock = vi.fn()
const sendHrDepartedMessagesMock = vi.fn()
const triggerTaxProjectionRefreshMock = vi.fn()

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

vi.mock('@repo/workflow-utils', () => ({
	NonRetryableError: class NonRetryableError extends Error {},
	esiRetryOptions: {},
	parseEsiErrorMetadata: () => null,
	withEsiRetryClassification: async (_label: string, fn: () => Promise<unknown> | unknown) =>
		await fn(),
}))

vi.mock('../../../workflows/steps/assets', () => ({
	syncAssets: (...args: unknown[]) => syncAssetsMock(...args),
}))

vi.mock('../../../workflows/steps/common', () => ({
	clearTaxProjectionRetryIntent: (...args: unknown[]) => clearTaxProjectionRetryIntentMock(...args),
	recordTaxProjectionRetryIntent: (...args: unknown[]) => recordTaxProjectionRetryIntentMock(...args),
	replayTaxProjectionRetryIntent: (...args: unknown[]) => replayTaxProjectionRetryIntentMock(...args),
	sendHrDepartedMessages: (...args: unknown[]) => sendHrDepartedMessagesMock(...args),
	triggerTaxProjectionRefresh: (...args: unknown[]) => triggerTaxProjectionRefreshMock(...args),
	updateCoreLastSync: (...args: unknown[]) => updateCoreLastSyncMock(...args),
	updateSyncTimestamps: (...args: unknown[]) => updateSyncTimestampsMock(...args),
}))

vi.mock('../../../workflows/steps/directors', () => ({
	recordDirectorSuccess: (...args: unknown[]) => recordDirectorSuccessMock(...args),
	reconcileDirectorsFromCorporationRoles: (...args: unknown[]) =>
		reconcileDirectorsFromCorporationRolesMock(...args),
	selectDirector: (...args: unknown[]) => selectDirectorMock(...args),
	verifyAllDirectorsHealth: (...args: unknown[]) => verifyAllDirectorsHealthMock(...args),
}))

vi.mock('../../../workflows/steps/structures', () => ({
	fetchStructures: (...args: unknown[]) => fetchStructuresMock(...args),
}))

function createStep() {
	const executedStepNames: string[] = []
	const doMock = vi.fn(async (name: string, optionsOrHandler: unknown, maybeHandler?: () => unknown) => {
		executedStepNames.push(name)
		const handler =
			typeof optionsOrHandler === 'function'
				? (optionsOrHandler as () => unknown)
				: (maybeHandler as () => unknown)
		return await handler()
	})

	return {
		executedStepNames,
		step: { do: doMock } as unknown as WorkflowStep,
		doMock,
	}
}

function createWorkflowEnv() {
	const corpDataNamespace = { __ns: 'EVE_CORPORATION_DATA' } as unknown as DurableObjectNamespace
	const updateCorporationAuthHealth = vi.fn().mockResolvedValue(undefined)
	const corpDataStub = {
		getCorporationSyncConfig: vi.fn().mockResolvedValue({
			includeInBackgroundRefresh: true,
			includeInStructureAssetSync: true,
		}),
		getDirectors: vi.fn().mockResolvedValue([{ isHealthy: true }]),
	}

	getStubMock.mockImplementation((namespace: unknown) => {
		if (namespace === corpDataNamespace) {
			return corpDataStub
		}
		return {}
	})

	return {
		env: {
			DATABASE_URL: 'postgres://test',
			ASSETS_SYNC_ENABLED: true,
			STRUCTURE_ENRICHMENT_ENABLED: false,
			EVE_TOKEN_STORE: {},
			CORPORATION_TAX: {},
			EVE_CORPORATION_DATA: corpDataNamespace,
			CORE: {
				updateCorporationAuthHealth,
			},
		} as never,
		corpDataStub,
		updateCorporationAuthHealth,
	}
}

describe('EveCorporationSyncWorkflow', () => {
	it('continues to asset sync even when the structure step fails', async () => {
		vi.clearAllMocks()
		const { env, corpDataStub, updateCorporationAuthHealth } = createWorkflowEnv()

		verifyAllDirectorsHealthMock.mockResolvedValue({
			verified: 1,
			failed: 0,
		})
		selectDirectorMock.mockResolvedValue({
			directorId: 'director-1',
			characterId: '900000001',
			characterName: 'Director One',
		})
		reconcileDirectorsFromCorporationRolesMock.mockResolvedValue(undefined)
		fetchStructuresMock.mockRejectedValue(new Error('Station Manager access required'))
		syncAssetsMock.mockResolvedValue({ assetsCount: 1 })
		updateSyncTimestampsMock.mockResolvedValue(undefined)
		updateCoreLastSyncMock.mockResolvedValue(undefined)
		recordDirectorSuccessMock.mockResolvedValue(undefined)
		replayTaxProjectionRetryIntentMock.mockResolvedValue({
			replayed: false,
			succeeded: false,
			retryCount: 0,
			reason: 'none',
		})
		clearTaxProjectionRetryIntentMock.mockResolvedValue(undefined)
		recordTaxProjectionRetryIntentMock.mockResolvedValue(undefined)
		sendHrDepartedMessagesMock.mockResolvedValue(undefined)
		triggerTaxProjectionRefreshMock.mockResolvedValue({
			triggered: false,
			reason: 'not-needed',
		})

		const workflow = new EveCorporationSyncWorkflow({} as ExecutionContext, env)
		const { step, executedStepNames } = createStep()

		await expect(
			workflow.run(
				{
					payload: {
						corporationId: '693378155',
						dataTypes: ['structures', 'assets'],
						trigger: 'cron',
					},
					instanceId: 'wf-1',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(executedStepNames).toContain('fetch-structures')
		expect(executedStepNames).toContain('sync-assets')
		expect(syncAssetsMock).toHaveBeenCalledWith(
			env,
			'693378155',
			'900000001',
			undefined
		)
		expect(updateSyncTimestampsMock).toHaveBeenCalledWith(env, '693378155', ['assets'])
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
		expect(corpDataStub.getCorporationSyncConfig).toHaveBeenCalledWith('693378155')
	})
})
