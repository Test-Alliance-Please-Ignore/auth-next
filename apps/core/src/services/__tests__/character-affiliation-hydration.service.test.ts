import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hydrateCharacterAffiliation } from '../character-affiliation-hydration.service'

const hoisted = vi.hoisted(() => ({
	mocks: {
		refreshPublicCharacterData: vi.fn(),
		resolveIds: vi.fn(),
		reconcileCharacterCorporationMembership: vi.fn(),
	},
	namespaces: {
		esiTypeResolver: Symbol('ESI_TYPE_RESOLVER'),
		eveCharacterData: Symbol('EVE_CHARACTER_DATA'),
		eveCorporationData: Symbol('EVE_CORPORATION_DATA'),
	},
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((namespace: symbol) => {
		if (namespace === hoisted.namespaces.esiTypeResolver) {
			return {
				resolveIds: hoisted.mocks.resolveIds,
			}
		}
		if (namespace === hoisted.namespaces.eveCharacterData) {
			return {
				refreshPublicCharacterData: hoisted.mocks.refreshPublicCharacterData,
			}
		}
		if (namespace === hoisted.namespaces.eveCorporationData) {
			return {
				reconcileCharacterCorporationMembership:
					hoisted.mocks.reconcileCharacterCorporationMembership,
			}
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
		updates,
		update,
	}
}

describe('hydrateCharacterAffiliation', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.mocks.reconcileCharacterCorporationMembership.mockResolvedValue({
			removedFromCorporationIds: [],
			addedToCorporationId: null,
		})
	})

	it('persists affiliation IDs immediately and resolves names in background', async () => {
		hoisted.mocks.refreshPublicCharacterData.mockResolvedValue({
			success: true,
			isDeleted: false,
			characterName: 'Zenith',
			currentCorporationId: '1000165',
			currentAllianceId: '498125261',
			previousCorporationId: null,
			previousAllianceId: null,
			affiliationChanged: true,
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
				ESI_TYPE_RESOLVER: hoisted.namespaces.esiTypeResolver as unknown as DurableObjectNamespace,
				EVE_TOKEN_STORE: {} as DurableObjectNamespace,
				EVE_CHARACTER_DATA:
					hoisted.namespaces.eveCharacterData as unknown as DurableObjectNamespace,
				EVE_CORPORATION_DATA:
					hoisted.namespaces.eveCorporationData as unknown as DurableObjectNamespace,
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
		expect(hoisted.mocks.reconcileCharacterCorporationMembership).toHaveBeenCalledWith(
			'93705729',
			'1000165'
		)

		expect(waitUntil).toHaveBeenCalledTimes(1)
		await waitUntil.mock.calls[0][0]

		expect(recorder.updates[1]).toMatchObject({
			corporationName: 'Hedion University',
			allianceName: 'Goonswarm Federation',
		})
	})

	it('returns deleted fallback when the shared public refresh reports deletion', async () => {
		hoisted.mocks.refreshPublicCharacterData.mockResolvedValue({
			success: false,
			isDeleted: true,
			characterName: '',
		})
		const recorder = createDbRecorder()

		const result = await hydrateCharacterAffiliation({
			db: recorder.db as never,
			env: {
				ESI_TYPE_RESOLVER: hoisted.namespaces.esiTypeResolver as unknown as DurableObjectNamespace,
				EVE_TOKEN_STORE: {} as DurableObjectNamespace,
				EVE_CHARACTER_DATA:
					hoisted.namespaces.eveCharacterData as unknown as DurableObjectNamespace,
			},
			characterId: '93705729',
			cacheMode: 'no-store',
		})

		expect(result).toMatchObject({
			characterId: '93705729',
			characterName: '',
			corporationId: '1000001',
			allianceId: null,
		})
		expect(recorder.update).toHaveBeenCalledTimes(1)
		expect(recorder.updates[0]).toMatchObject({
			isDeleted: true,
		})
		expect(hoisted.mocks.reconcileCharacterCorporationMembership).not.toHaveBeenCalled()
	})

	it('skips name resolution when no execution context is provided', async () => {
		hoisted.mocks.refreshPublicCharacterData.mockResolvedValue({
			success: true,
			isDeleted: false,
			characterName: 'Zenith',
			currentCorporationId: '1000165',
			currentAllianceId: null,
			previousCorporationId: null,
			previousAllianceId: null,
			affiliationChanged: true,
		})
		const recorder = createDbRecorder()

		await hydrateCharacterAffiliation({
			db: recorder.db as never,
			env: {
				ESI_TYPE_RESOLVER: hoisted.namespaces.esiTypeResolver as unknown as DurableObjectNamespace,
				EVE_TOKEN_STORE: {} as DurableObjectNamespace,
				EVE_CHARACTER_DATA:
					hoisted.namespaces.eveCharacterData as unknown as DurableObjectNamespace,
			},
			characterId: '93705729',
			cacheMode: 'no-store',
		})

		expect(recorder.update).toHaveBeenCalledTimes(1)
		expect(hoisted.mocks.resolveIds).not.toHaveBeenCalled()
		expect(hoisted.mocks.reconcileCharacterCorporationMembership).not.toHaveBeenCalled()
	})
})
