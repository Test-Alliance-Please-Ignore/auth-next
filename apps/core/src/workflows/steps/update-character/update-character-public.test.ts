import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateCharacterPublicInfo } from './update-character-public'

import type { WorkflowContext } from '../../context'

const refreshPublicCharacterData = vi.fn()
const resolveIds = vi.fn()
const markCharacterDeleted = vi.fn()

const ESI_TYPE_RESOLVER_NS = Symbol('ESI_TYPE_RESOLVER')
const EVE_CHARACTER_DATA_NS = Symbol('EVE_CHARACTER_DATA')
const EVE_TOKEN_STORE_NS = Symbol('EVE_TOKEN_STORE')

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((namespace: symbol) => {
		if (namespace === ESI_TYPE_RESOLVER_NS) {
			return { resolveIds }
		}
		if (namespace === EVE_CHARACTER_DATA_NS) {
			return { refreshPublicCharacterData }
		}
		if (namespace === EVE_TOKEN_STORE_NS) {
			return { markCharacterDeleted }
		}
		return {}
	}),
}))

function createDbRecorder() {
	const updates: unknown[] = []
	const where = vi.fn().mockResolvedValue(undefined)
	const set = vi.fn((payload: unknown) => {
		updates.push(payload)
		return { where }
	})
	const update = vi.fn(() => ({ set }))

	return {
		db: { update, query: { userCharacters: { findFirst: vi.fn() } } },
		update,
		set,
		where,
		updates,
	}
}

function createCtx(db: WorkflowContext['db']): WorkflowContext {
	return {
		db,
		env: {
			ESI: {} as DurableObjectNamespace,
			ESI_TYPE_RESOLVER: ESI_TYPE_RESOLVER_NS as unknown as DurableObjectNamespace,
			EVE_CHARACTER_DATA: EVE_CHARACTER_DATA_NS as unknown as DurableObjectNamespace,
			EVE_TOKEN_STORE: EVE_TOKEN_STORE_NS as unknown as DurableObjectNamespace,
		} as WorkflowContext['env'],
		userId: 'user-1',
		workflowInstanceId: 'workflow-1',
		refreshMode: 'manual',
	}
}

describe('updateCharacterPublicInfo', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resolveIds.mockResolvedValue({})
		markCharacterDeleted.mockResolvedValue(true)
	})

	it('returns isDeleted true when the shared public refresh reports deletion', async () => {
		refreshPublicCharacterData.mockResolvedValue({
			success: false,
			isDeleted: true,
		})
		const recorder = createDbRecorder()

		const result = await updateCharacterPublicInfo(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'123'
		)

		expect(result.isDeleted).toBe(true)
		expect(recorder.update).toHaveBeenCalledTimes(1)
		expect(recorder.updates[0]).toMatchObject({
			isDeleted: true,
			hasValidToken: false,
		})
		expect(markCharacterDeleted).toHaveBeenCalledWith('123')
	})

	it('resets deleted status on successful refresh persistence', async () => {
		refreshPublicCharacterData.mockResolvedValue({
			success: true,
			isDeleted: false,
			characterName: 'Recovered Capsuleer',
			currentCorporationId: '99000002',
			currentAllianceId: null,
			previousCorporationId: null,
			previousAllianceId: null,
			affiliationChanged: true,
		})
		resolveIds.mockResolvedValue({ '99000002': 'Example Corp' })
		const recorder = createDbRecorder()

		await updateCharacterPublicInfo(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'99000124'
		)

		expect(recorder.updates[0]).toMatchObject({
			characterName: 'Recovered Capsuleer',
			corporationId: '99000002',
			isDeleted: false,
		})
	})

	it('rethrows non-deleted public refresh failures', async () => {
		refreshPublicCharacterData.mockRejectedValue(new Error('upstream timeout'))
		const recorder = createDbRecorder()

		await expect(
			updateCharacterPublicInfo(createCtx(recorder.db as unknown as WorkflowContext['db']), '123')
		).rejects.toThrow('upstream timeout')

		expect(recorder.update).not.toHaveBeenCalled()
		expect(markCharacterDeleted).not.toHaveBeenCalled()
	})

	it('persists affiliation ids even if name resolution fails', async () => {
		refreshPublicCharacterData.mockResolvedValue({
			success: true,
			isDeleted: false,
			characterName: 'Test Capsuleer',
			currentCorporationId: '99000001',
			currentAllianceId: '99000010',
			previousCorporationId: null,
			previousAllianceId: null,
			affiliationChanged: true,
		})
		resolveIds.mockRejectedValue(new Error('resolver unavailable'))
		const recorder = createDbRecorder()

		const result = await updateCharacterPublicInfo(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'99000123'
		)

		expect(result.affiliationChanged).toBe(true)
		expect(recorder.updates[0]).toMatchObject({
			characterName: 'Test Capsuleer',
			corporationId: '99000001',
			allianceId: '99000010',
			isDeleted: false,
		})
		expect(recorder.updates).toHaveLength(1)
	})
})
