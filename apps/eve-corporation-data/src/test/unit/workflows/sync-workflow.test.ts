import { describe, expect, it, vi } from 'vitest'

import { EveCorporationSyncWorkflow } from '../../../workflows/sync-workflow'
import { StructureEnrichmentScopeMismatchError } from '../../../workflows/utils/structure-enrichment-auth'

import type { WorkflowStep } from 'cloudflare:workers'

const getStubMock = vi.fn()
const syncAssetsMock = vi.fn()
const fetchStructuresMock = vi.fn()
const fetchSovereigntyEnrichmentMock = vi.fn()
const fetchSkyhookEnrichmentMock = vi.fn()
const fetchMiningExtractionEnrichmentMock = vi.fn()
const storeStructuresMock = vi.fn()
const storeSovereigntyEnrichmentMock = vi.fn()
const storeSkyhookEnrichmentMock = vi.fn()
const storeMiningExtractionEnrichmentMock = vi.fn()
const markStructureEnrichmentSyncFailureMock = vi.fn()
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
	fetchSovereigntyEnrichment: (...args: unknown[]) => fetchSovereigntyEnrichmentMock(...args),
	fetchSkyhookEnrichment: (...args: unknown[]) => fetchSkyhookEnrichmentMock(...args),
	fetchMiningExtractionEnrichment: (...args: unknown[]) =>
		fetchMiningExtractionEnrichmentMock(...args),
	markStructureEnrichmentSyncFailure: (...args: unknown[]) =>
		markStructureEnrichmentSyncFailureMock(...args),
	storeStructures: (...args: unknown[]) => storeStructuresMock(...args),
	storeSovereigntyEnrichment: (...args: unknown[]) => storeSovereigntyEnrichmentMock(...args),
	storeSkyhookEnrichment: (...args: unknown[]) => storeSkyhookEnrichmentMock(...args),
	storeMiningExtractionEnrichment: (...args: unknown[]) =>
		storeMiningExtractionEnrichmentMock(...args),
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
			structuresLastSync: null,
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

	it('passes the current corporation structure listing through to storage so stale rows can be pruned', async () => {
		vi.clearAllMocks()
		const { env, updateCorporationAuthHealth } = createWorkflowEnv()

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
		fetchStructuresMock.mockResolvedValue([
			{
				structure_id: 'structure-1',
				type_id: '35832',
			},
		])
		storeStructuresMock.mockResolvedValue(undefined)
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
		const { step } = createStep()

		await expect(
			workflow.run(
				{
					payload: {
						corporationId: '693378155',
						dataTypes: ['structures', 'assets'],
						trigger: 'cron',
					},
					instanceId: 'wf-1b',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(storeStructuresMock).toHaveBeenCalledTimes(1)
		expect(storeStructuresMock).toHaveBeenCalledWith(env, '693378155', [
			{
				structure_id: 'structure-1',
				type_id: '35832',
			},
		])
		expect(syncAssetsMock).toHaveBeenCalledWith(env, '693378155', '900000001', ['structure-1'])
		expect(updateSyncTimestampsMock).toHaveBeenCalledWith(
			env,
			'693378155',
			['assets', 'structures']
		)
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
	})

	it('includes skyhook listing and prune metrics in the structures sync stats', async () => {
		vi.clearAllMocks()
		const { env, updateCorporationAuthHealth } = createWorkflowEnv()

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
		fetchStructuresMock.mockResolvedValue([
			{
				structure_id: 'structure-1',
				type_id: '35832',
			},
		])
		fetchSovereigntyEnrichmentMock.mockResolvedValue(null)
		fetchSkyhookEnrichmentMock.mockResolvedValue({
			skyhooks: [
				{
					structure_id: 'skyhook-1',
				},
			],
		})
		storeStructuresMock.mockResolvedValue(undefined)
		storeSovereigntyEnrichmentMock.mockResolvedValue(undefined)
		storeSkyhookEnrichmentMock.mockResolvedValue({ prunedCount: 2 })
		storeMiningExtractionEnrichmentMock.mockResolvedValue(undefined)
		syncAssetsMock.mockResolvedValue({ assetsCount: 0 })
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
		const { step } = createStep()

		await expect(
			workflow.run(
				{
					payload: {
						corporationId: '693378155',
						dataTypes: ['structures'],
						trigger: 'cron',
					},
					instanceId: 'wf-structures-metrics',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
			stats: {
				structuresCount: 1,
				skyhooksCount: 1,
				skyhooksReturnedCount: 1,
				skyhooksPrunedCount: 2,
			},
		})

		expect(updateCorporationAuthHealth).toHaveBeenCalled()
	})

	it('marks sovereignty enrichment sync failure state when scope-mismatched auth is suppressed', async () => {
		vi.clearAllMocks()
		const { env, updateCorporationAuthHealth } = createWorkflowEnv()

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
		fetchStructuresMock.mockResolvedValue([
			{
				structure_id: 'structure-1',
				type_id: '32458',
			},
		])
		fetchSovereigntyEnrichmentMock.mockRejectedValue(
			new StructureEnrichmentScopeMismatchError(
				'sovereignty-hubs',
				'Sovereignty hub enrichment requires updated director scopes.'
			)
		)
		fetchSkyhookEnrichmentMock.mockResolvedValue(null)
		storeStructuresMock.mockResolvedValue(undefined)
		storeSovereigntyEnrichmentMock.mockResolvedValue(undefined)
		storeSkyhookEnrichmentMock.mockResolvedValue(undefined)
		storeMiningExtractionEnrichmentMock.mockResolvedValue(undefined)
		markStructureEnrichmentSyncFailureMock.mockResolvedValue(undefined)
		syncAssetsMock.mockResolvedValue({ assetsCount: 0 })
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
						dataTypes: ['structures'],
						trigger: 'cron',
					},
					instanceId: 'wf-structures-failure',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(markStructureEnrichmentSyncFailureMock).toHaveBeenCalledWith(
			env,
			'693378155',
			'sovereignty-hubs',
			'Sovereignty hub enrichment requires updated director scopes.'
		)
		expect(selectDirectorMock).toHaveBeenCalledTimes(1)
		expect(executedStepNames).toContain('store-structure-sovereignty-enrichment-failure')
		expect(updateSyncTimestampsMock).toHaveBeenCalledWith(env, '693378155', [])
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
	})

	it('runs mining enrichment for mining citadels and still continues to asset sync', async () => {
		vi.clearAllMocks()
		const { env, updateCorporationAuthHealth } = createWorkflowEnv()

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
		fetchStructuresMock.mockResolvedValue([
			{
				structure_id: '1000001',
				type_id: '35833',
			},
		])
		fetchSovereigntyEnrichmentMock.mockResolvedValue(null)
		fetchSkyhookEnrichmentMock.mockResolvedValue(null)
		fetchMiningExtractionEnrichmentMock.mockResolvedValue([
			{
				structure_id: '1000001',
			},
			{
				structure_id: '1000002',
			},
		])
		storeStructuresMock.mockResolvedValue(undefined)
		storeSovereigntyEnrichmentMock.mockResolvedValue(undefined)
		storeSkyhookEnrichmentMock.mockResolvedValue(undefined)
		storeMiningExtractionEnrichmentMock.mockResolvedValue(undefined)
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
					instanceId: 'wf-2',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(fetchMiningExtractionEnrichmentMock).toHaveBeenCalledTimes(1)
		expect(storeMiningExtractionEnrichmentMock).toHaveBeenCalledTimes(1)
		expect(storeMiningExtractionEnrichmentMock).toHaveBeenCalledWith(env, '693378155', [
			{
				structure_id: '1000001',
			},
		])
		expect(executedStepNames).toContain('sync-assets')
		expect(syncAssetsMock).toHaveBeenCalledWith(env, '693378155', '900000001', ['1000001'])
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
	})

	it('keeps asset sync running when mining enrichment fails for a mining citadel run', async () => {
		vi.clearAllMocks()
		const { env, updateCorporationAuthHealth } = createWorkflowEnv()

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
		fetchStructuresMock.mockResolvedValue([
			{
				structure_id: '2000001',
				type_id: '35833',
			},
		])
		fetchSovereigntyEnrichmentMock.mockResolvedValue(null)
		fetchSkyhookEnrichmentMock.mockResolvedValue(null)
		fetchMiningExtractionEnrichmentMock.mockRejectedValue(new Error('boom'))
		storeStructuresMock.mockResolvedValue(undefined)
		storeSovereigntyEnrichmentMock.mockResolvedValue(undefined)
		storeSkyhookEnrichmentMock.mockResolvedValue(undefined)
		storeMiningExtractionEnrichmentMock.mockResolvedValue(undefined)
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
					instanceId: 'wf-3',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(fetchMiningExtractionEnrichmentMock).toHaveBeenCalledTimes(1)
		expect(storeMiningExtractionEnrichmentMock).not.toHaveBeenCalled()
		expect(executedStepNames).toContain('sync-assets')
		expect(syncAssetsMock).toHaveBeenCalledWith(env, '693378155', '900000001', ['2000001'])
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
	})

	it('skips structure enrichment work when the structure sync is within the cooldown window', async () => {
		vi.clearAllMocks()
		const { env, corpDataStub, updateCorporationAuthHealth } = createWorkflowEnv()
		corpDataStub.getCorporationSyncConfig.mockResolvedValue({
			includeInBackgroundRefresh: true,
			includeInStructureAssetSync: true,
			structuresLastSync: new Date('2026-07-12T18:50:00.000Z'),
		})

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
		fetchStructuresMock.mockResolvedValue([
			{
				structure_id: '1000001',
				type_id: '35833',
			},
		])
		storeStructuresMock.mockResolvedValue(undefined)
		storeSovereigntyEnrichmentMock.mockResolvedValue(undefined)
		fetchSkyhookEnrichmentMock.mockResolvedValue({
			skyhooks: [],
		})
		storeSkyhookEnrichmentMock.mockResolvedValue(undefined)
		storeMiningExtractionEnrichmentMock.mockResolvedValue(undefined)
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
					instanceId: 'wf-4',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(fetchStructuresMock).not.toHaveBeenCalled()
		expect(storeStructuresMock).not.toHaveBeenCalled()
		expect(fetchSovereigntyEnrichmentMock).not.toHaveBeenCalled()
		expect(fetchSkyhookEnrichmentMock).not.toHaveBeenCalled()
		expect(storeSkyhookEnrichmentMock).not.toHaveBeenCalled()
		expect(fetchMiningExtractionEnrichmentMock).not.toHaveBeenCalled()
		expect(executedStepNames).not.toContain('store-structure-sovereignty-enrichment')
		expect(executedStepNames).not.toContain('store-structure-skyhook-enrichment')
		expect(executedStepNames).not.toContain('store-structure-mining-extraction-enrichment')
		expect(updateSyncTimestampsMock).toHaveBeenCalledWith(env, '693378155', ['assets'])
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
	})
})
