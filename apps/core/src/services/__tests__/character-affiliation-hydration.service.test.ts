import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hydrateCharacterAffiliation } from '../character-affiliation-hydration.service'

const hoisted = vi.hoisted(() => ({
	mocks: {
		fetchCharacterPublicInfo: vi.fn(),
		resolveIds: vi.fn(),
	},
}))

vi.mock('@repo/esi', () => ({
	getEsiInstanceForCharacter: vi.fn(() => ({
		fetchCharacterPublicInfo: hoisted.mocks.fetchCharacterPublicInfo,
	})),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(() => ({
		resolveIds: hoisted.mocks.resolveIds,
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
		updates,
		update,
	}
}

describe('hydrateCharacterAffiliation', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('persists affiliation IDs immediately and resolves names in background', async () => {
		hoisted.mocks.fetchCharacterPublicInfo.mockResolvedValue({
			name: 'Zenith',
			corporation_id: '1000165',
			alliance_id: '498125261',
		})
		hoisted.mocks.resolveIds.mockResolvedValue({
			'1000165': 'Hedion University',
			'498125261': 'Goonswarm Federation',
		})
		const recorder = createDbRecorder()
		const waitUntil = vi.fn((promise: Promise<unknown>) => promise)

		const result = await hydrateCharacterAffiliation({
			db: recorder.db as never,
			env: {
				ESI: {} as DurableObjectNamespace,
				ESI_TYPE_RESOLVER: {} as DurableObjectNamespace,
			},
			characterId: '93705729',
			cacheMode: 'no-store',
			executionCtx: { waitUntil } as unknown as ExecutionContext,
		})

		expect(result).toMatchObject({
			characterId: '93705729',
			characterName: 'Zenith',
			corporationId: '1000165',
			allianceId: '498125261',
		})
		expect(recorder.updates[0]).toMatchObject({
			characterName: 'Zenith',
			corporationId: '1000165',
			allianceId: '498125261',
			isDeleted: false,
		})

		expect(waitUntil).toHaveBeenCalledTimes(1)
		await waitUntil.mock.calls[0][0]

		expect(recorder.updates[1]).toMatchObject({
			corporationName: 'Hedion University',
			allianceName: 'Goonswarm Federation',
		})
	})

	it('skips name resolution when no execution context is provided', async () => {
		hoisted.mocks.fetchCharacterPublicInfo.mockResolvedValue({
			name: 'Zenith',
			corporation_id: '1000165',
		})
		const recorder = createDbRecorder()

		await hydrateCharacterAffiliation({
			db: recorder.db as never,
			env: {
				ESI: {} as DurableObjectNamespace,
				ESI_TYPE_RESOLVER: {} as DurableObjectNamespace,
			},
			characterId: '93705729',
			cacheMode: 'no-store',
		})

		expect(recorder.update).toHaveBeenCalledTimes(1)
		expect(hoisted.mocks.resolveIds).not.toHaveBeenCalled()
	})
})
