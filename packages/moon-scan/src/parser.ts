import { MOON_GOO_TYPE_IDS, MOON_ORE_TYPE_IDS } from './reprocessing'

export interface ParsedOre {
	oreName: string
	oreTypeId: string
	quantity: string // decimal fraction stored as string e.g. "0.2524"
}

export interface ParsedScan {
	moonId: string
	moonName: string
	solarSystemId: string
	planetId: string
	ores: ParsedOre[]
	warnings: string[]
}

export interface ParseResult {
	scans: ParsedScan[]
	errors: string[]
}

const HEADER_PREFIX = 'Moon\t'
const NUMERIC_ID_RE = /^\d+$/
const ALLOWED_ORE_TYPE_IDS = new Set<string>([...MOON_ORE_TYPE_IDS, ...MOON_GOO_TYPE_IDS])

export function parseMoonScanTsv(raw: string): ParseResult {
	const lines = raw.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
	const errors: string[] = []
	const seenMoonIds = new Set<string>()

	type PendingScan = {
		moonName: string
		moonId: string | null
		solarSystemId: string | null
		planetId: string | null
		ores: ParsedOre[]
		warnings: string[]
		errors: string[]
	}

	let current: PendingScan | null = null
	const finalScans: ParsedScan[] = []

	function finalizeCurrent() {
		if (!current) return

		const { moonName, moonId, solarSystemId, planetId, ores, warnings } = current

		if (current.errors.length > 0) {
			for (const error of current.errors) {
				errors.push(`Moon "${moonName}": ${error}`)
			}
			return
		}

		if (ores.length === 0) {
			errors.push(`Moon "${moonName}": no ore rows found`)
			return
		}
		if (!moonId || !solarSystemId || !planetId) {
			errors.push(`Moon "${moonName}": missing ID data (moonId=${moonId}, systemId=${solarSystemId})`)
			return
		}
		if (!NUMERIC_ID_RE.test(moonId)) {
			errors.push(`Moon "${moonName}": invalid moonId "${moonId}"`)
			return
		}
		if (!NUMERIC_ID_RE.test(solarSystemId)) {
			errors.push(`Moon "${moonName}": invalid solarSystemId "${solarSystemId}"`)
			return
		}
		if (!NUMERIC_ID_RE.test(planetId)) {
			errors.push(`Moon "${moonName}": invalid planetId "${planetId}"`)
			return
		}

		// Quantity sum validation: must be in [0.99, 1.01]
		const sum = ores.reduce((acc, o) => acc + parseFloat(o.quantity), 0)
		if (sum < 0.99 || sum > 1.01) {
			errors.push(`Moon "${moonName}": quantities sum to ${sum.toFixed(4)} (expected ~1.0)`)
			return
		}

		// Ore count validation
		if (ores.length < 2) {
			errors.push(`Moon "${moonName}": only ${ores.length} ore type(s) found (expected 2–4)`)
			return
		}
		if (ores.length > 4) {
			errors.push(`Moon "${moonName}": ${ores.length} ore types found (expected at most 4)`)
			return
		}

		if (seenMoonIds.has(moonId)) {
			// Duplicate: skip and warn
			errors.push(`Moon ID ${moonId} appears more than once — keeping first occurrence`)
			return
		}

		seenMoonIds.add(moonId)
		finalScans.push({ moonId, moonName, solarSystemId, planetId, ores, warnings })
	}

	for (const line of lines) {
		const stripped = line.trim()

		// Skip empty lines and header row
		if (!stripped || stripped.startsWith(HEADER_PREFIX)) continue

		const parts = line.split('\t')
		const isOreRow = line.startsWith('\t') || parts[0] === ''

		if (isOreRow) {
			if (!current) {
				// Ore row with no preceding moon header — skip
				continue
			}

			// Format: [empty], OreName, Quantity, OreTypeID, SolarSystemID, PlanetID, MoonID
			const nonEmpty = parts.map((p) => p.trim()).filter((p) => p.length > 0)
			if (nonEmpty.length < 4) continue

			const oreName = nonEmpty[0]
			const quantityRaw = nonEmpty[1]
			const oreTypeId = nonEmpty[2]
			const solarSystemId = nonEmpty[3] ?? null
			const planetId = nonEmpty[4] ?? null
			const moonId = nonEmpty[5] ?? null

				const quantity = parseFloat(quantityRaw)
				if (Number.isNaN(quantity) || quantity <= 0 || quantity > 1) {
					current.errors.push(`invalid quantity "${quantityRaw}" for ${oreName}`)
					continue
				}
				if (!/^\d+$/.test(oreTypeId)) {
					current.errors.push(`invalid ore type ID "${oreTypeId}" for ${oreName}`)
					continue
				}
				if (!ALLOWED_ORE_TYPE_IDS.has(oreTypeId)) {
					current.errors.push(`ore type ID "${oreTypeId}" for ${oreName} is not allowed for moon scans`)
					continue
				}

			// Fill in IDs from ore row if not yet set on the moon block
			if (moonId && !current.moonId) current.moonId = moonId
			if (solarSystemId && !current.solarSystemId) current.solarSystemId = solarSystemId
			if (planetId && !current.planetId) current.planetId = planetId

			current.ores.push({ oreName, oreTypeId, quantity: quantity.toFixed(6) })
		} else {
			// Moon header row
			finalizeCurrent()
			current = {
				moonName: stripped,
				moonId: null,
				solarSystemId: null,
				planetId: null,
					ores: [],
					warnings: [],
					errors: [],
				}
			}
		}

	// Don't forget the last block
	finalizeCurrent()

	if (finalScans.length === 0 && errors.length === 0) {
		errors.push('No valid moon scan data found in input')
	}

	return { scans: finalScans, errors }
}
