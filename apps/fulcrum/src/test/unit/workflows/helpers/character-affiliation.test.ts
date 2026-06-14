import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CharacterAffiliationCoordinator } from '../../../../workflows/processors/helpers/character-affiliation'

const {
	fetchAlliancePublicInfo,
	fetchCharacterAffiliation,
	fetchCorporationPublicInfo,
	getIdClassification,
} = vi.hoisted(() => ({
	fetchAlliancePublicInfo: vi.fn(),
	fetchCharacterAffiliation: vi.fn(),
	fetchCorporationPublicInfo: vi.fn(),
	getIdClassification: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((namespace: { kind?: string }) => {
		if (namespace?.kind === 'esi') {
			return {
				fetchAlliancePublicInfo,
				fetchCharacterAffiliation,
				fetchCorporationPublicInfo,
			}
		}
		return {}
	}),
}))

vi.mock('@repo/eve-types', () => ({
	getIdClassification,
}))

describe('CharacterAffiliationCoordinator', () => {
	const env = {
		ESI: { kind: 'esi' } as unknown as DurableObjectNamespace,
	}

	beforeEach(() => {
		fetchAlliancePublicInfo.mockReset()
		fetchCharacterAffiliation.mockReset()
		fetchCorporationPublicInfo.mockReset()
		getIdClassification.mockReset()
		getIdClassification.mockReturnValue({ type: 'character' })
	})

	it('prefers alliance tickers and caches resolved display names for the run', async () => {
		fetchCharacterAffiliation.mockResolvedValue([
			{ character_id: '1001', corporation_id: '2001', alliance_id: '3001' },
		])
		fetchCorporationPublicInfo.mockResolvedValue({ ticker: 'CORP' })
		fetchAlliancePublicInfo.mockResolvedValue({ ticker: 'ALLI' })

		const coordinator = new CharacterAffiliationCoordinator()

		const first = await coordinator.resolveDisplayNames(
			env,
			'9000',
			[{ characterId: '1001', characterName: 'Pilot', forceCharacter: true }],
			'test-character-affiliation',
		)

		expect(first).toEqual({
			1001: '[ALLI] Pilot',
		})

		const second = await coordinator.resolveDisplayNames(
			env,
			'9000',
			[{ characterId: '1001', characterName: 'Changed Name', forceCharacter: true }],
			'test-character-affiliation',
		)

		expect(second).toEqual({
			1001: '[ALLI] Pilot',
		})
		expect(fetchCharacterAffiliation).toHaveBeenCalledTimes(1)
		expect(fetchCorporationPublicInfo).toHaveBeenCalledTimes(1)
		expect(fetchAlliancePublicInfo).toHaveBeenCalledTimes(1)
	})

	it('falls back to corporation tickers when no alliance ticker exists', async () => {
		fetchCharacterAffiliation.mockResolvedValue([
			{ character_id: '1002', corporation_id: '2002', alliance_id: null },
		])
		fetchCorporationPublicInfo.mockResolvedValue({ ticker: 'CORP' })

		const coordinator = new CharacterAffiliationCoordinator()
		const result = await coordinator.resolveDisplayNames(
			env,
			'9000',
			[{ characterId: '1002', characterName: 'Pilot Two', forceCharacter: true }],
			'test-character-affiliation',
		)

		expect(result).toEqual({
			1002: '[CORP] Pilot Two',
		})
		expect(fetchCharacterAffiliation).toHaveBeenCalledTimes(1)
		expect(fetchCorporationPublicInfo).toHaveBeenCalledTimes(1)
		expect(fetchAlliancePublicInfo).not.toHaveBeenCalled()
	})

	it('leaves non-character identifiers untouched and does not attempt affiliation lookup', async () => {
		getIdClassification.mockReturnValue({ type: 'corporation' })

		const coordinator = new CharacterAffiliationCoordinator()
		const result = await coordinator.resolveDisplayNames(
			env,
			'9000',
			[{ characterId: '2002', characterName: 'Corporate Entity' }],
			'test-character-affiliation',
		)

		expect(result).toEqual({
			2002: 'Corporate Entity',
		})
		expect(fetchCharacterAffiliation).not.toHaveBeenCalled()
		expect(fetchCorporationPublicInfo).not.toHaveBeenCalled()
		expect(fetchAlliancePublicInfo).not.toHaveBeenCalled()
	})
})
