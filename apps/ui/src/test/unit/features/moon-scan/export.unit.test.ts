import { describe, expect, it } from 'vitest'

import { buildScannedMoonsCsv } from '@/features/moon-scan/export'

describe('moon-scan csv export', () => {
	it('flattens moon and ore detail rows into CSV', () => {
		const csv = buildScannedMoonsCsv(
			[
				{
					moonId: 'moon-1',
					moonName: 'Moon 1',
					solarSystemId: 'sys-1',
					solarSystemName: 'System 1',
					regionId: 'reg-1',
					regionName: 'Region 1',
					constellationId: 'const-1',
					constellationName: 'Constellation 1',
					securityStatus: '0.5',
					highestRarity: 'R64',
					metenoxProfit: '12345',
					tataraProfit: '67890',
				},
			],
			{
				'moon-1': {
					moon: {
						moonId: 'moon-1',
						moonName: 'Moon 1',
						solarSystemId: 'sys-1',
						solarSystemName: 'System 1',
					},
					scans: [],
					composition: null,
					profitability: {
						ores: [
							{
								oreTypeId: '45490',
								oreName: 'Bitumens',
								quantity: '0.25',
								rarity: 'R64',
								totalOreValue: '987654',
								refinesTo: [],
							},
						],
						structures: [],
						updatedAt: '2026-07-01T00:00:00.000Z',
					},
				} as any,
			}
		)

		expect(csv).toContain(
			'regionId,regionName,solarSystemId,solarSystemName,moonId,moonName,securityStatus,highestRarity,metenoxProfit,tataraProfit,oreTypeId,oreTypeName,oreRarity,oreCompositionPercent,oreTotalOreValue'
		)
		expect(csv).toContain('reg-1')
		expect(csv).toContain('sys-1')
		expect(csv).toContain('moon-1')
		expect(csv).toContain('45490')
		expect(csv).toContain('Bitumens')
		expect(csv).toContain('25.00%')
		expect(csv).toContain('987654')
	})
})
