import { getStub } from '@repo/do-utils'
import {
	CATEGORY_SLOT_OVERRIDES,
	CATEGORY_SUBSYSTEM,
	EFT_SECTION_ORDER,
	SLOT_FLAGS,
} from '@repo/doctrines'

import type { FittingItem } from '@repo/doctrines'
import type { Universe } from '@repo/universe'

export interface ParsedFitting {
	shipName: string
	shipTypeId: string
	fittingName: string
	items: Array<Omit<FittingItem, 'id' | 'fittingId'>>
	unresolvedItems: string[]
}

/**
 * EFT section order (separated by blank lines):
 * Low Slots → Mid Slots → High Slots → Rigs → Subsystems → Drones → Cargo
 *
 * Most ships have no subsystems, so sections after rigs shift:
 * Low → Mid → High → Rigs → Drones → Cargo
 *
 * We assign provisional flags by index, then re-classify after type resolution
 * based on EVE category IDs (drones=18, implants=20, subsystems=32, charges=8).
 */

/** EFT sections without subsystem slot, derived from the shared section order */
const EFT_SECTION_ORDER_NO_SUBS = EFT_SECTION_ORDER.filter((id) => id !== '125')

export class EftParser {
	constructor(private universeNs: DurableObjectNamespace) { }

	public async parse(eftString: string): Promise<ParsedFitting> {
		const rawLines = eftString.trim().split('\n')
		if (rawLines.length < 2) {
			throw new Error('Invalid EFT string format')
		}

		// --- Parse Header ---
		const headerLine = rawLines.shift()!.trim()
		const headerMatch = headerLine.match(/^\[([^,]+),\s*([^\]]+)\]$/)
		if (!headerMatch) {
			throw new Error('Invalid EFT header format')
		}
		const shipName = headerMatch[1].trim()
		const fittingName = headerMatch[2].trim()

		// --- Split remaining lines into sections by blank lines ---
		// Skip any leading blank lines after the header
		while (rawLines.length > 0 && rawLines[0].trim() === '') {
			rawLines.shift()
		}

		const sections: string[][] = []
		let currentSection: string[] = []

		for (const line of rawLines) {
			if (line.trim() === '') {
				if (currentSection.length > 0) {
					sections.push(currentSection)
					currentSection = []
				}
			} else {
				currentSection.push(line.trim())
			}
		}
		if (currentSection.length > 0) {
			sections.push(currentSection)
		}

		// --- Parse Items with section tracking ---
		const itemNames = new Set<string>()
		const itemData: Array<{
			name: string
			quantity: number
			flagId: string
			flagName: string
			sectionIndex: number
		}> = []

		for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
			const section = sections[sectionIndex]
			const flagId = EFT_SECTION_ORDER[sectionIndex] ?? '0'
			const flag = SLOT_FLAGS[flagId]

			for (const line of section) {
				if (line.startsWith('[Empty') || line.startsWith('[Subsystem')) {
					continue
				}

				let chargeName: string | null = null
				let itemName: string
				let quantity: number

				// Match items with quantity (e.g., "Tremor S x1000")
				const quantityMatch = line.match(/^(.*)\s+x(\d+)$/)

				if (quantityMatch) {
					itemName = quantityMatch[1].trim()
					quantity = parseInt(quantityMatch[2], 10)
				} else {
					// Check for "Module, Charge" pattern
					const commaIndex = line.indexOf(',')
					if (commaIndex > 0) {
						itemName = line.substring(0, commaIndex).trim()
						chargeName = line.substring(commaIndex + 1).trim()
					} else {
						itemName = line.trim()
					}
					quantity = 1
				}

				itemNames.add(itemName)
				itemData.push({
					name: itemName,
					quantity,
					flagId: flag?.flagId ?? '0',
					flagName: flag?.flagName ?? 'Unknown',
					sectionIndex,
				})

				// Add charge as a separate cargo item
				if (chargeName) {
					itemNames.add(chargeName)
					itemData.push({
						name: chargeName,
						quantity: 1,
						flagId: '5',
						flagName: 'Cargo',
						sectionIndex,
					})
				}
			}
		}

		// --- Resolve Type IDs ---
		const allTypeNames = [shipName, ...Array.from(itemNames)]
		const stub = getStub<Universe>(this.universeNs, 'default')
		const typeIdMap = await stub.resolveTypeIdsByNames(allTypeNames)

		// Resolve ship type ID
		const shipType = typeIdMap[shipName]
		if (!shipType) {
			throw new Error(`Failed to resolve ship type ID for: ${shipName}`)
		}

		// --- Resolve Group IDs to get Category IDs and Group Names ---
		const groupIds = new Set<string>()
		for (const typeName of allTypeNames) {
			const type = typeIdMap[typeName]
			if (type) {
				groupIds.add(type.groupId)
			}
		}

		const groupIdMap = await stub.resolveInvGroups([...groupIds])

		// --- Detect if ship has subsystems ---
		// If any item in section 4 (index 4) is actually a subsystem, keep mapping as-is.
		// Otherwise, shift sections 4+ down (skip Subsystem Slot).
		let hasSubsystems = false
		for (const item of itemData) {
			if (item.sectionIndex === 4) {
				const resolved = typeIdMap[item.name]
				if (resolved) {
					const group = groupIdMap[resolved.groupId]
					if (group?.categoryId === CATEGORY_SUBSYSTEM) {
						hasSubsystems = true
						break
					}
				}
			}
		}

		// --- Build Items Array ---
		const rawItems: Array<Omit<FittingItem, 'id' | 'fittingId'>> = []
		const unresolvedItems: string[] = []
		for (const { name, quantity, flagId, flagName, sectionIndex } of itemData) {
			const itemType = typeIdMap[name]
			if (!itemType) {
				unresolvedItems.push(name)
				continue
			}

			const group = groupIdMap[itemType.groupId]
			const categoryId = group?.categoryId ?? '-1'
			const groupName = group?.groupName ?? 'Unknown'

			// Determine correct flag — re-classify based on category
			let finalFlagId = flagId
			let finalFlagName = flagName

			// If this item came from a charge split, keep it as Cargo
			if (flagId === '5' && flagName === 'Cargo') {
				// Already correct
			} else if (!hasSubsystems && sectionIndex >= 4) {
				// Remap sections after rigs when ship has no subsystems
				const remappedFlagId = EFT_SECTION_ORDER_NO_SUBS[sectionIndex]
				const remapped = remappedFlagId ? SLOT_FLAGS[remappedFlagId] : undefined
				finalFlagId = remapped?.flagId ?? '5'
				finalFlagName = remapped?.flagName ?? 'Cargo'
			}

			// Category-based overrides (drones → Drone Bay, fighters → Fighter Bay, etc.)
			const override = CATEGORY_SLOT_OVERRIDES[categoryId]
			if (override) {
				// Charges already in cargo need no override
				if (!(categoryId === '8' && finalFlagId === '5')) {
					finalFlagId = override.flagId
					finalFlagName = override.flagName
				}
			}

			rawItems.push({
				typeId: itemType.typeId,
				typeName: itemType.typeName,
				quantity: String(quantity),
				flagId: finalFlagId,
				flagName: finalFlagName,
				groupId: itemType.groupId,
				groupName,
				categoryId,
			})
		}

		// --- Merge duplicate items in non-indexed slots (cargo, drones, fighters) ---
		const mergedMap = new Map<string, Omit<FittingItem, 'id' | 'fittingId'>>()
		const items: Array<Omit<FittingItem, 'id' | 'fittingId'>> = []

		for (const item of rawItems) {
			const flag = SLOT_FLAGS[item.flagId]
			if (flag && !flag.indexed) {
				// Non-indexed slot: merge by typeId+flagId
				const key = `${item.typeId}:${item.flagId}`
				const existing = mergedMap.get(key)
				if (existing) {
					existing.quantity = String(parseInt(existing.quantity) + parseInt(item.quantity))
				} else {
					mergedMap.set(key, { ...item })
				}
			} else {
				// Indexed slot: keep individual entries for slot numbering
				items.push(item)
			}
		}
		items.push(...mergedMap.values())

		return {
			shipName,
			shipTypeId: shipType.typeId,
			fittingName,
			items,
			unresolvedItems,
		}
	}
}
