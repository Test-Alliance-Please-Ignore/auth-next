import { buildCsv } from '@/lib/csv-utils'

import type { MoonDetail, ScannedMoonEntry } from './types'

export type MoonDetailById = Record<string, MoonDetail | null | undefined>

export function buildScannedMoonsCsv(items: ScannedMoonEntry[], detailsByMoonId: MoonDetailById): string {
	const headers = [
		'regionId',
		'regionName',
		'solarSystemId',
		'solarSystemName',
		'moonId',
		'moonName',
		'securityStatus',
		'highestRarity',
		'metenoxProfit',
		'tataraProfit',
		'oreTypeId',
		'oreTypeName',
		'oreRarity',
		'oreCompositionPercent',
		'oreTotalOreValue',
	]

	const rows: Array<Array<string | number | boolean | null | undefined>> = []

	for (const moon of items) {
		const detail = detailsByMoonId[moon.moonId]
		const ores = detail?.profitability?.ores ?? []
		if (ores.length === 0) {
			rows.push([
				moon.regionId,
				moon.regionName,
				moon.solarSystemId,
				moon.solarSystemName,
				moon.moonId,
				moon.moonName,
				moon.securityStatus ?? '',
				moon.highestRarity ?? '',
				moon.metenoxProfit ?? '',
				moon.tataraProfit ?? '',
				'',
				'',
				'',
				'',
				'',
			])
			continue
		}

		for (const ore of ores) {
			rows.push([
				moon.regionId,
				moon.regionName,
				moon.solarSystemId,
				moon.solarSystemName,
				moon.moonId,
				moon.moonName,
				moon.securityStatus ?? '',
				moon.highestRarity ?? '',
				moon.metenoxProfit ?? '',
				moon.tataraProfit ?? '',
				ore.oreTypeId,
				ore.oreName,
				ore.rarity ?? '',
				`${(Number.parseFloat(ore.quantity) * 100).toFixed(2)}%`,
				ore.totalOreValue,
			])
		}
	}

	return buildCsv(headers, rows)
}
