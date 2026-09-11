import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getEsiInstanceForCharacter, getPublicEsiInstance } from '@repo/esi'

import { createDb } from './db'
import { UniverseDO } from './durable-object'

import type { Env } from './context'

vi.mock('cloudflare:workers', () => ({
	DurableObject: class DurableObject {
		constructor(
			public state: DurableObjectState,
			public env: Env
		) {}
	},
}))

vi.mock('./db', () => ({
	createDb: vi.fn(),
}))

vi.mock('@repo/esi', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@repo/esi')>()
	return {
		...actual,
		getEsiInstanceForCharacter: vi.fn(),
		getPublicEsiInstance: vi.fn(),
	}
})

function createSelectChain<T>(rows: T[]) {
	return {
		from: () => ({
			where: () => ({
				orderBy: () => ({
					limit: async () => rows,
				}),
			}),
		}),
	}
}

function createDbMock(rows: unknown[]) {
	const insert = vi.fn(() => ({
		values: () => ({
			onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
		}),
	}))
	return {
		select: vi.fn(() => createSelectChain(rows)),
		insert,
	}
}

function createUniverse(db: ReturnType<typeof createDbMock>) {
	vi.mocked(createDb).mockReturnValue(db as never)
	return new UniverseDO(
		{} as DurableObjectState,
		{
			DATABASE_URL: 'https://example.invalid',
			ESI: {} as DurableObjectNamespace,
			ESI_TYPE_RESOLVER: {} as DurableObjectNamespace,
			UNIVERSE: {} as DurableObjectNamespace,
		} as Env
	)
}

describe('Universe organization search', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns an exact indexed corporation without using authenticated ESI search', async () => {
		const db = createDbMock([{ id: '987', name: 'KarmaFleet', ticker: 'KARM' }])
		const publicEsi = {
			fetchCorporationPublicInfo: vi.fn().mockResolvedValue({
				name: 'KarmaFleet',
				ticker: 'KARM',
				alliance_id: undefined,
			}),
		}
		vi.mocked(getPublicEsiInstance).mockReturnValue(publicEsi as never)

		const result = await createUniverse(db).searchCorporations('KarmaFleet', 20, '42')

		expect(result).toEqual([
			{ id: '987', name: 'KarmaFleet', ticker: 'KARM', type: 'corporation', parentAlliance: null },
		])
		expect(getEsiInstanceForCharacter).not.toHaveBeenCalled()
		expect(db.insert).not.toHaveBeenCalled()
	})

	it('falls back to ESI search and backfills corporation and alliance metadata', async () => {
		const db = createDbMock([])
		const searchOrganizations = vi.fn().mockResolvedValue({ corporation: ['987'], alliance: [] })
		vi.mocked(getEsiInstanceForCharacter).mockReturnValue({ searchOrganizations } as never)
		const publicEsi = {
			fetchCorporationPublicInfo: vi.fn().mockResolvedValue({
				name: 'KarmaFleet',
				ticker: 'KARM',
				alliance_id: '123',
			}),
			fetchAlliancePublicInfo: vi
				.fn()
				.mockResolvedValue({ name: 'Goonswarm Federation', ticker: 'CONDI' }),
		}
		vi.mocked(getPublicEsiInstance).mockReturnValue(publicEsi as never)

		const result = await createUniverse(db).searchCorporations('karma', 20, '42')

		expect(searchOrganizations).toHaveBeenCalledWith('42', 'karma', ['corporation'], false)
		expect(result[0]).toMatchObject({
			id: '987',
			name: 'KarmaFleet',
			parentAlliance: { name: 'Goonswarm Federation', ticker: 'CONDI' },
		})
		expect(db.insert).toHaveBeenCalled()
	})
})
