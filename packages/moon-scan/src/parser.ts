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

export function parseMoonScanTsv(raw: string): ParseResult {
	const lines = raw.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
	const errors: string[] = []
	const seenMoonIds = new Set<string>()

	const pending: {
		moonName: string
		moonId: string | null
		solarSystemId: string | null
		planetId: string | null
		ores: ParsedOre[]
		warnings: string[]
	} | null = null

	// We'll accumulate using a mutable reference pattern
	let current: (typeof pending) = null
	const finalScans: ParsedScan[] = []

	function finalizeCurrent() {
		if (!current) return

		const { moonName, moonId, solarSystemId, planetId, ores, warnings } = current

		if (ores.length === 0) {
			errors.push(`Moon "${moonName}": no ore rows found`)
			return
		}
		if (!moonId || !solarSystemId || !planetId) {
			errors.push(`Moon "${moonName}": missing ID data (moonId=${moonId}, systemId=${solarSystemId})`)
			return
		}

		// Quantity sum validation: must be in [0.99, 1.01]
		const sum = ores.reduce((acc, o) => acc + parseFloat(o.quantity), 0)
		if (sum < 0.99 || sum > 1.01) {
			warnings.push(`Quantities sum to ${sum.toFixed(4)} (expected ~1.0)`)
		}

		// Ore count validation
		if (ores.length < 2) {
			warnings.push(`Only ${ores.length} ore type(s) found (expected 2–4)`)
		}
		if (ores.length > 4) {
			warnings.push(`${ores.length} ore types found (expected at most 4)`)
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
				current.warnings.push(`Invalid quantity "${quantityRaw}" for ${oreName} — skipping ore`)
				continue
			}
			if (!/^\d+$/.test(oreTypeId)) {
				current.warnings.push(`Invalid ore type ID "${oreTypeId}" for ${oreName} — skipping ore`)
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
