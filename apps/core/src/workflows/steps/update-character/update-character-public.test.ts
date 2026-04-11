import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CharacterDeletedError } from '@repo/esi'

import { updateCharacterPublicInfo } from './update-character-public'

import type { WorkflowContext } from '../../context'

const fetchCharacterPublicInfo = vi.fn()
const fetchCharacterAffiliation = vi.fn()
const resolveIds = vi.fn()
const markCharacterDeleted = vi.fn()
const storePublicInfo = vi.fn()
const fetchCorporationHistory = vi.fn()

const ESI_TYPE_RESOLVER_NS = Symbol('ESI_TYPE_RESOLVER')
const EVE_CHARACTER_DATA_NS = Symbol('EVE_CHARACTER_DATA')
const EVE_TOKEN_STORE_NS = Symbol('EVE_TOKEN_STORE')

vi.mock('@repo/esi', () => ({
	CharacterDeletedError: class CharacterDeletedError extends Error {
		constructor(characterId: string) {
			super(`Character ${characterId} has been deleted`)
		}
	},
	getEsiInstanceForCharacter: vi.fn(() => ({
		fetchCharacterPublicInfo,
		fetchCharacterAffiliation,
	})),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((namespace: symbol) => {
		if (namespace === ESI_TYPE_RESOLVER_NS) {
			return { resolveIds }
		}
		if (namespace === EVE_CHARACTER_DATA_NS) {
			return {
				storePublicInfo,
				fetchCorporationHistory,
			}
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
		storePublicInfo.mockResolvedValue(undefined)
		fetchCorporationHistory.mockResolvedValue(undefined)
		markCharacterDeleted.mockResolvedValue(true)
	})

	it('returns isDeleted true only for explicit deleted-character responses', async () => {
		fetchCharacterPublicInfo.mockRejectedValue(new Error('Character has been deleted!'))
		fetchCharacterAffiliation.mockResolvedValue([])
		resolveIds.mockResolvedValue({})
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

	it('returns isDeleted true for CharacterDeletedError (non-retryable 404)', async () => {
		fetchCharacterPublicInfo.mockRejectedValue(new CharacterDeletedError('123'))
		fetchCharacterAffiliation.mockResolvedValue([])
		resolveIds.mockResolvedValue({})
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
		fetchCharacterPublicInfo.mockResolvedValue({
			name: 'Recovered Capsuleer',
			corporation_id: '99000002',
			alliance_id: undefined,
			birthday: '2026-01-01T00:00:00Z',
			bloodline_id: '1',
			gender: 'male',
			race_id: '1',
		})
		fetchCharacterAffiliation.mockResolvedValue([
			{ character_id: '99000124', corporation_id: '99000002', alliance_id: undefined },
		])
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
		fetchCharacterAffiliation.mockResolvedValue([])
		resolveIds.mockResolvedValue({})
		const recorder = createDbRecorder()

		await expect(
			updateCharacterPublicInfo(createCtx(recorder.db as unknown as WorkflowContext['db']), '123')
		).rejects.toThrow('upstream timeout')

		expect(recorder.update).not.toHaveBeenCalled()
		expect(markCharacterDeleted).not.toHaveBeenCalled()
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
		fetchCharacterAffiliation.mockResolvedValue([
			{ character_id: '99000123', corporation_id: '99000001', alliance_id: '99000010' },
		])
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

	it('prefers affiliation corporation over public info when they differ', async () => {
		fetchCharacterPublicInfo.mockResolvedValue({
			name: 'Moving Capsuleer',
			corporation_id: '99000001',
			alliance_id: undefined,
			birthday: '2026-01-01T00:00:00Z',
			bloodline_id: '1',
			gender: 'male',
			race_id: '1',
		})
		fetchCharacterAffiliation.mockResolvedValue([
			{ character_id: '99000123', corporation_id: '99000002', alliance_id: '99000010' },
		])
		resolveIds.mockResolvedValue({ '99000002': 'New Corp', '99000010': 'Some Alliance' })
		const recorder = createDbRecorder()

		const result = await updateCharacterPublicInfo(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'99000123'
		)

		expect(result.corporationId).toBe('99000002')
		expect(result.allianceId).toBe('99000010')
		expect(recorder.updates[0]).toMatchObject({
			corporationId: '99000002',
			allianceId: '99000010',
		})
	})

	it('falls back to public info corporation when affiliation fetch fails', async () => {
		fetchCharacterPublicInfo.mockResolvedValue({
			name: 'Test Capsuleer',
			corporation_id: '99000001',
			alliance_id: '99000010',
			birthday: '2026-01-01T00:00:00Z',
			bloodline_id: '1',
			gender: 'male',
			race_id: '1',
		})
		fetchCharacterAffiliation.mockRejectedValue(new Error('affiliation unavailable'))
		resolveIds.mockResolvedValue({ '99000001': 'Fallback Corp', '99000010': 'Some Alliance' })
		const recorder = createDbRecorder()

		const result = await updateCharacterPublicInfo(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'99000123'
		)

		expect(result.corporationId).toBe('99000001')
		expect(result.allianceId).toBe('99000010')
		expect(recorder.updates[0]).toMatchObject({
			corporationId: '99000001',
			allianceId: '99000010',
		})
	})

	it('falls back to public info when affiliation response does not include the character', async () => {
		fetchCharacterPublicInfo.mockResolvedValue({
			name: 'Test Capsuleer',
			corporation_id: '99000001',
			alliance_id: undefined,
			birthday: '2026-01-01T00:00:00Z',
			bloodline_id: '1',
			gender: 'male',
			race_id: '1',
		})
		fetchCharacterAffiliation.mockResolvedValue([
			{ character_id: '99999999', corporation_id: '99000002' },
		])
		resolveIds.mockResolvedValue({ '99000001': 'Fallback Corp' })
		const recorder = createDbRecorder()

		const result = await updateCharacterPublicInfo(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'99000123'
		)

		expect(result.corporationId).toBe('99000001')
	})
})
