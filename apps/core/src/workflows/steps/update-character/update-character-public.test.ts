import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateCharacterPublicInfo } from './update-character-public'

import type { WorkflowContext } from '../../context'

const fetchCharacterPublicInfo = vi.fn()
const resolveIds = vi.fn()

vi.mock('@repo/esi', () => ({
	CharacterDeletedError: class CharacterDeletedError extends Error {
		constructor(characterId: string) {
			super(`Character ${characterId} has been deleted`)
		}
	},
	getEsiInstanceForCharacter: vi.fn(() => ({
		fetchCharacterPublicInfo,
	})),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(() => ({
		resolveIds,
	})),
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
		db: { update },
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
			ESI_TYPE_RESOLVER: {} as DurableObjectNamespace,
		} as WorkflowContext['env'],
		userId: 'user-1',
		workflowInstanceId: 'workflow-1',
		refreshMode: 'manual',
	}
}

describe('updateCharacterPublicInfo', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns isDeleted true only for explicit deleted-character responses', async () => {
		fetchCharacterPublicInfo.mockRejectedValue(new Error('Character has been deleted!'))
		resolveIds.mockResolvedValue({})
		const recorder = createDbRecorder()

		const result = await updateCharacterPublicInfo(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'123'
		)

		expect(result.isDeleted).toBe(true)
		expect(recorder.update).not.toHaveBeenCalled()
	})

	it('resets deleted status on successful refresh persistence', async () => {
		fetchCharacterPublicInfo.mockResolvedValue({
			name: 'Recovered Capsuleer',
			corporation_id: '99000002',
			alliance_id: undefined,
			birthday: '2026-01-01T00:00:00Z',
			bloodline_id: '1',
			gender: 'male',
			race_id: '1',
		})
		resolveIds.mockResolvedValue({ '99000002': 'Example Corp' })
		const recorder = createDbRecorder()

		await updateCharacterPublicInfo(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'99000124'
		)

		expect(recorder.updates[0]).toMatchObject({
			corporationId: '99000002',
			isDeleted: false,
		})
	})

	it('rethrows non-deleted public info fetch failures', async () => {
		fetchCharacterPublicInfo.mockRejectedValue(new Error('upstream timeout'))
		resolveIds.mockResolvedValue({})
		const recorder = createDbRecorder()

		await expect(
			updateCharacterPublicInfo(createCtx(recorder.db as unknown as WorkflowContext['db']), '123')
		).rejects.toThrow('upstream timeout')

		expect(recorder.update).not.toHaveBeenCalled()
	})

	it('persists affiliation ids even if name resolution fails', async () => {
		fetchCharacterPublicInfo.mockResolvedValue({
			name: 'Test Capsuleer',
			corporation_id: '99000001',
			alliance_id: '99000010',
			birthday: '2026-01-01T00:00:00Z',
			bloodline_id: '1',
			gender: 'male',
			race_id: '1',
		})
		resolveIds.mockRejectedValue(new Error('resolver unavailable'))
		const recorder = createDbRecorder()

		const result = await updateCharacterPublicInfo(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'99000123'
		)

		expect(result.isDeleted).toBe(false)
		expect(result.corporationId).toBe('99000001')
		expect(result.allianceId).toBe('99000010')
		expect(result.corporationName).toBeNull()
		expect(result.allianceName).toBeNull()
		expect(recorder.update).toHaveBeenCalledTimes(1)
		expect(recorder.updates[0]).toMatchObject({
			characterName: 'Test Capsuleer',
			corporationId: '99000001',
			allianceId: '99000010',
		})
	})
})
