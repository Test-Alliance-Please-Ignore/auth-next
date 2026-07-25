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
const fetchPublicInfoMock = vi.fn()
const storePublicInfoMock = vi.fn()
const markStructureEnrichmentSyncFailureMock = vi.fn()
const markStructureSyncFailureReasonMock = vi.fn()
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
const parseEsiErrorMetadataMock = vi.fn((_message: string) => null as { status: number } | null)

vi.mock('cloudflare:workers', () => {
	class WorkflowEntrypoint<Env = unknown, Params = unknown> {
		protected readonly ctx: unknown
		protected readonly env: Env

		constructor(ctx: unknown, env: Env) {
			this.ctx = ctx
			this.env = env
		}

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
	parseEsiErrorMetadata: (message: string) => parseEsiErrorMetadataMock(message),
	withEsiRetryClassification: async (_label: string, fn: () => Promise<unknown> | unknown) =>
		await fn(),
}))

vi.mock('../../../workflows/steps/assets', () => ({
	syncAssets: (...args: unknown[]) => syncAssetsMock(...args),
}))

vi.mock('../../../workflows/steps/public-info', () => ({
	fetchPublicInfo: (...args: unknown[]) => fetchPublicInfoMock(...args),
	storePublicInfo: (...args: unknown[]) => storePublicInfoMock(...args),
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
	markStructureSyncFailureReason: (...args: unknown[]) =>
		markStructureSyncFailureReasonMock(...args),
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
	const tokenStoreNamespace = { __ns: 'EVE_TOKEN_STORE' } as unknown as DurableObjectNamespace
	const updateCorporationAuthHealth = vi.fn().mockResolvedValue(undefined)
	const addDirector = vi.fn().mockResolvedValue(undefined)
	const getCharacterOwner = vi.fn()
	const coreStub = {
		updateCorporationAuthHealth,
		getCharacterOwner,
	}
	const corpDataStub = {
		addDirector,
		getCorporationInfo: vi.fn().mockResolvedValue(null),
		getCorporationSyncConfig: vi.fn().mockResolvedValue({
			includeInBackgroundRefresh: true,
			includeInStructureAssetSync: true,
			structuresLastSync: null,
		}),
		getDirectors: vi.fn().mockResolvedValue([{ isHealthy: true }]),
		getMiningCitadelSyncPriorities: vi.fn().mockResolvedValue([]),
		getMiningCitadelStructureIds: vi.fn().mockResolvedValue([]),
		getMissingStructureIdsForPriorityQueue: vi.fn().mockResolvedValue([]),
		getSovereigntyHubSyncPriorities: vi.fn().mockResolvedValue([]),
		getSovereigntyHubStructureIds: vi.fn().mockResolvedValue([]),
		getSkyhookSyncPriorities: vi.fn().mockResolvedValue([]),
		getSkyhookStructureIds: vi.fn().mockResolvedValue([]),
	}
	const tokenStoreStub = {
		fetchPublicEsi: vi.fn(),
		fetchCharacterAffiliations: vi.fn(),
		resolveIds: vi.fn(),
	}

	getStubMock.mockImplementation((namespace: unknown) => {
		if (namespace === corpDataNamespace) {
			return corpDataStub
		}
		if (namespace === tokenStoreNamespace) {
			return tokenStoreStub
		}
		return {
			getMissingStructureIdsForPriorityQueue: vi.fn().mockResolvedValue([]),
		}
	})

	return {
		env: {
			DATABASE_URL: 'postgres://test',
			EVE_TOKEN_STORE: tokenStoreNamespace,
			CORPORATION_TAX: {},
			EVE_CORPORATION_DATA: corpDataNamespace,
			CORE: coreStub,
		},
		corpDataStub,
		tokenStoreStub,
		updateCorporationAuthHealth,
	}
}

describe('EveCorporationSyncWorkflow', () => {
	it('bootstraps the current CEO when no healthy director is selectable', async () => {
	vi.clearAllMocks()
	const { env, corpDataStub, tokenStoreStub, updateCorporationAuthHealth } =
		createWorkflowEnv()

	vi.mocked(env.CORE.getCharacterOwner).mockResolvedValue({
		userId: 'user-12345',
		isPrimary: true,
	})
	vi.mocked(tokenStoreStub.fetchCharacterAffiliations).mockResolvedValue([
		{
			character_id: 12345,
			corporation_id: 693378155,
		},
	] as never)
	vi.mocked(tokenStoreStub.resolveIds).mockResolvedValue({
		12345: 'Bootstrap CEO',
	} as never)
	corpDataStub.getCorporationInfo.mockResolvedValue({ ceoId: '12345' } as never)
	fetchPublicInfoMock.mockResolvedValue({
		corporationId: '693378155',
		name: 'Corp',
		ceoId: '12345',
		})
		storePublicInfoMock.mockResolvedValue(undefined)
		verifyAllDirectorsHealthMock.mockResolvedValue({
			verified: 0,
			failed: 1,
		})
		selectDirectorMock
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				directorId: 'director-1',
				characterId: '12345',
				characterName: 'Bootstrap CEO',
			})
		reconcileDirectorsFromCorporationRolesMock.mockResolvedValue(undefined)
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
						dataTypes: ['public-info'],
						trigger: 'cron',
					},
					instanceId: 'wf-bootstrap-ceo',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(corpDataStub.addDirector).toHaveBeenCalledWith('693378155', '12345', 'Bootstrap CEO', 0)
		expect(reconcileDirectorsFromCorporationRolesMock).toHaveBeenCalledWith(
			env,
			'693378155',
			'12345'
		)
		expect(updateCorporationAuthHealth).toHaveBeenCalled()

		selectDirectorMock.mockReset()
		fetchPublicInfoMock.mockReset()
		storePublicInfoMock.mockReset()
	})

	it('explicitly verifies a linked CEO even when healthy directors already exist', async () => {
		vi.clearAllMocks()
		const { env, corpDataStub, tokenStoreStub } = createWorkflowEnv()

		vi.mocked(env.CORE.getCharacterOwner).mockResolvedValue({
			userId: 'user-12345',
			isPrimary: true,
		})
		vi.mocked(tokenStoreStub.fetchCharacterAffiliations).mockResolvedValue([
			{
				character_id: 12345,
				corporation_id: 693378155,
			},
		] as never)
		vi.mocked(tokenStoreStub.resolveIds).mockResolvedValue({
			12345: 'Linked CEO',
		} as never)
		corpDataStub.getDirectors.mockResolvedValue([
			{
				directorId: 'director-1',
				characterId: '900000001',
				characterName: 'Healthy Director',
				isHealthy: true,
			},
		] as never)
		fetchPublicInfoMock.mockResolvedValue({
			corporationId: '693378155',
			name: 'Corp',
			ceoId: '12345',
		})
		storePublicInfoMock.mockResolvedValue(undefined)
		verifyAllDirectorsHealthMock.mockResolvedValue({
			verified: 1,
			failed: 0,
		})
		selectDirectorMock.mockResolvedValue({
			directorId: 'director-1',
			characterId: '900000001',
			characterName: 'Healthy Director',
		})
		reconcileDirectorsFromCorporationRolesMock.mockResolvedValue({
			added: 0,
			removed: 0,
			discovered: 1,
			skippedUnlinked: 0,
		})
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
						dataTypes: ['public-info'],
						trigger: 'cron',
					},
					instanceId: 'wf-linked-ceo',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(env.CORE.getCharacterOwner).toHaveBeenCalledWith('12345')
	expect(corpDataStub.addDirector).toHaveBeenCalledWith('693378155', '12345', 'Linked CEO', 0)
	expect(reconcileDirectorsFromCorporationRolesMock).toHaveBeenCalledWith(
		env,
		'693378155',
		'900000001'
	)
	})

	it('does not promote a linked CEO when live affiliation shows a different corporation', async () => {
		vi.clearAllMocks()
		const { env, corpDataStub, tokenStoreStub } = createWorkflowEnv()

		vi.mocked(env.CORE.getCharacterOwner).mockResolvedValue({
			userId: 'user-12345',
			isPrimary: true,
		})
		vi.mocked(tokenStoreStub.fetchCharacterAffiliations).mockResolvedValue([
			{
				character_id: 12345,
				corporation_id: 555555555,
			},
		] as never)
		corpDataStub.getDirectors.mockResolvedValue([
			{
				directorId: 'director-1',
				characterId: '900000001',
				characterName: 'Healthy Director',
				isHealthy: true,
			},
		] as never)
		fetchPublicInfoMock.mockResolvedValue({
			corporationId: '693378155',
			name: 'Corp',
			ceoId: '12345',
		})
		storePublicInfoMock.mockResolvedValue(undefined)
		verifyAllDirectorsHealthMock.mockResolvedValue({
			verified: 1,
			failed: 0,
		})
		selectDirectorMock.mockResolvedValue({
			directorId: 'director-1',
			characterId: '900000001',
			characterName: 'Healthy Director',
		})
		reconcileDirectorsFromCorporationRolesMock.mockResolvedValue({
			added: 0,
			removed: 0,
			discovered: 1,
			skippedUnlinked: 0,
		})
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
						dataTypes: ['public-info'],
						trigger: 'cron',
					},
					instanceId: 'wf-linked-ceo-mismatch',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(env.CORE.getCharacterOwner).toHaveBeenCalledWith('12345')
		expect(corpDataStub.addDirector).not.toHaveBeenCalled()
		expect(reconcileDirectorsFromCorporationRolesMock).toHaveBeenCalledWith(
			env,
			'693378155',
			'900000001'
		)
	})

	it('continues to asset sync even when the structure step fails', async () => {
		vi.clearAllMocks()
		parseEsiErrorMetadataMock.mockImplementation(() => null)
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
		markStructureSyncFailureReasonMock.mockResolvedValue(undefined)
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

		expect(syncAssetsMock).toHaveBeenCalledWith(env, '693378155', '900000001')
		expect(markStructureSyncFailureReasonMock).toHaveBeenCalledWith(
			env,
			'693378155',
			'structures',
			'Station Manager access required'
		)
		expect(updateSyncTimestampsMock).toHaveBeenCalledWith(
			env,
			'693378155',
			['assets', 'skyhooks']
		)
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
		expect(corpDataStub.getCorporationSyncConfig).toHaveBeenCalledWith('693378155')
	})

	it('keeps a prior structure failure sticky even if a later enrichment hits rate limit', async () => {
		vi.clearAllMocks()
		parseEsiErrorMetadataMock.mockImplementation((message: string) =>
			message.includes('429 Too Many Requests')
				? {
						status: 429,
					}
				: null
		)
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
		fetchSovereigntyEnrichmentMock.mockRejectedValue(
			new Error(
				'ESI request failed: 429 Too Many Requests - {"error":"ESI rate limit active"} | metadata={"status":429,"path":"/corporations/693378155/structures/sovereignty-hubs/10001"}'
			)
		)
		markStructureSyncFailureReasonMock.mockResolvedValue(undefined)
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
					instanceId: 'wf-1-rate-limit',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(markStructureSyncFailureReasonMock).toHaveBeenCalledWith(
			env,
			'693378155',
			'structures',
			'Station Manager access required'
		)
		expect(updateSyncTimestampsMock).toHaveBeenCalledWith(
			env,
			'693378155',
			['assets', 'skyhooks']
		)
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
		expect(corpDataStub.getCorporationSyncConfig).toHaveBeenCalledWith('693378155')
	})

	it('keeps skyhook failures from suppressing the structures timestamp update', async () => {
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
		fetchStructuresMock.mockResolvedValue([
			{
				structure_id: 'structure-1',
				type_id: '35832',
			},
		])
		fetchSovereigntyEnrichmentMock.mockResolvedValue(null)
		fetchSkyhookEnrichmentMock.mockRejectedValue(new Error('skyhook boom'))
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
		const { step } = createStep()

		await expect(
			workflow.run(
				{
					payload: {
						corporationId: '693378155',
						dataTypes: ['structures', 'assets'],
						trigger: 'cron',
					},
					instanceId: 'wf-1-skyhook',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(updateSyncTimestampsMock).toHaveBeenCalledWith(
			env,
			'693378155',
			['assets', 'structures', 'skyhooks']
		)
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
		expect(corpDataStub.getCorporationSyncConfig).toHaveBeenCalledWith('693378155')
	})

	it('persists structure failure reasons for non-retryable store errors', async () => {
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
		storeStructuresMock.mockRejectedValue(new Error('database write failed'))
		markStructureSyncFailureReasonMock.mockResolvedValue(undefined)
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
					instanceId: 'wf-1c',
					timestamp: new Date('2026-07-12T19:36:47.369Z'),
				} as never,
				step
			)
		).resolves.toMatchObject({
			success: true,
			corporationId: '693378155',
			trigger: 'cron',
		})

		expect(markStructureSyncFailureReasonMock).toHaveBeenCalledWith(
			env,
			'693378155',
			'structures',
			'database write failed'
		)
		expect(syncAssetsMock).toHaveBeenCalledWith(env, '693378155', '900000001')
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
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
		expect(syncAssetsMock).toHaveBeenCalledWith(env, '693378155', '900000001')
		expect(updateSyncTimestampsMock).toHaveBeenCalledWith(
			env,
			'693378155',
			['assets', 'structures', 'skyhooks']
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
			failureCount: 0,
			rateLimitFailureCount: 0,
			nonRateLimitFailureCount: 0,
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
		const { step } = createStep()

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
		expect(updateSyncTimestampsMock).toHaveBeenCalledWith(env, '693378155', ['skyhooks'])
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
	})

	it('runs mining enrichment for mining citadels and still continues to asset sync', async () => {
		vi.clearAllMocks()
		const { env, corpDataStub, updateCorporationAuthHealth } = createWorkflowEnv()
		corpDataStub.getMiningCitadelSyncPriorities.mockResolvedValue([
			{
				structureId: '1000001',
				lastAttemptedSyncAt: null,
				lastSyncedAt: new Date('2026-07-10T00:00:00.000Z'),
			},
		])

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
		const { step } = createStep()

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
		expect(syncAssetsMock).toHaveBeenCalledWith(env, '693378155', '900000001')
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
	})

	it('keeps asset sync running when mining enrichment fails for a mining citadel run', async () => {
		vi.clearAllMocks()
		const { env, corpDataStub, updateCorporationAuthHealth } = createWorkflowEnv()
		corpDataStub.getMiningCitadelSyncPriorities.mockResolvedValue([
			{
				structureId: '2000001',
				lastAttemptedSyncAt: null,
				lastSyncedAt: new Date('2026-07-10T00:00:00.000Z'),
			},
		])

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
		const { step } = createStep()

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
		expect(syncAssetsMock).toHaveBeenCalledWith(env, '693378155', '900000001')
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
	})

	it('still runs structure enrichment work even when the corp-level structure timestamp is stale', async () => {
		vi.clearAllMocks()
		const { env, corpDataStub, updateCorporationAuthHealth } = createWorkflowEnv()
		corpDataStub.getCorporationSyncConfig.mockResolvedValue({
			includeInBackgroundRefresh: true,
			includeInStructureAssetSync: true,
			structuresLastSync: new Date('2026-07-12T18:50:00.000Z'),
		})
		corpDataStub.getMiningCitadelSyncPriorities.mockResolvedValue([
			{
				structureId: '3000001',
				lastAttemptedSyncAt: null,
				lastSyncedAt: new Date('2026-07-10T00:00:00.000Z'),
			},
		])

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
		storeStructuresMock.mockResolvedValue(undefined)
		storeSovereigntyEnrichmentMock.mockResolvedValue(undefined)
		fetchSkyhookEnrichmentMock.mockResolvedValue({
			skyhooks: [],
			failureCount: 0,
			rateLimitFailureCount: 0,
			nonRateLimitFailureCount: 0,
		})
		storeSkyhookEnrichmentMock.mockResolvedValue({ prunedCount: 0 })
		fetchMiningExtractionEnrichmentMock.mockResolvedValue([])
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
		const { step } = createStep()

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

		expect(fetchStructuresMock).toHaveBeenCalled()
		expect(storeStructuresMock).toHaveBeenCalled()
		expect(fetchSovereigntyEnrichmentMock).toHaveBeenCalled()
		expect(fetchSkyhookEnrichmentMock).toHaveBeenCalled()
		expect(storeSkyhookEnrichmentMock).toHaveBeenCalled()
		expect(fetchMiningExtractionEnrichmentMock).toHaveBeenCalled()
		expect(updateSyncTimestampsMock).toHaveBeenCalledWith(
			env,
			'693378155',
			['assets', 'structures', 'skyhooks']
		)
		expect(updateCorporationAuthHealth).toHaveBeenCalled()
	})
})
