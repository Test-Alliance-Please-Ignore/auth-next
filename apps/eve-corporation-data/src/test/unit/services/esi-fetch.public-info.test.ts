import { describe, expect, it, vi } from 'vitest'

import { fetchPublicInfo } from '../../../services/esi-fetch'

describe('public corporation info ESI mapping', () => {
	it('maps ESI wire fields into the persistence model', async () => {
		const esi = {
			fetchCorporationPublicInfo: vi.fn().mockResolvedValue({
				alliance_id: '99000001',
				ceo_id: '90000001',
				creator_id: '90000002',
				date_founded: '2026-01-02T03:04:05.000Z',
				description: 'Public description',
				faction_id: '500001',
				home_station_id: '60000001',
				member_count: '42',
				name: 'Example Corporation',
				shares: '1000',
				tax_rate: '0.1',
				ticker: 'EX',
				url: 'https://example.invalid',
				war_eligible: true,
			}),
		}

		const result = await fetchPublicInfo(esi as never, '98000001')

		expect(esi.fetchCorporationPublicInfo).toHaveBeenCalledWith('98000001')
		expect(result).toMatchObject({
			corporationId: '98000001',
			name: 'Example Corporation',
			ceoId: '90000001',
			creatorId: '90000002',
			homeStationId: '60000001',
			memberCount: 42,
			taxRate: '0.1',
			allianceId: '99000001',
			factionId: '500001',
			warEligible: true,
		})
		expect(result.dateFounded).toEqual(new Date('2026-01-02T03:04:05.000Z'))
	})
})
