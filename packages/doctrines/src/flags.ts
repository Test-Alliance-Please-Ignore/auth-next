/**
 * Shared EVE inventory flag constants
 *
 * Single source of truth for flag IDs, names, ESI prefixes, and display labels.
 * Used by the EFT parser, ESI save route, and UI slot list.
 */

export interface SlotFlag {
    flagId: string
    flagName: string
    /** ESI fitting flag prefix, or null if not saveable to ESI (e.g. implants) */
    esiPrefix: string | null
    /** UI display label */
    label: string
    /** true = numbered slots (HiSlot0, HiSlot1…), false = single flag name */
    indexed: boolean
}

/** All known slot flags keyed by flagId */
export const SLOT_FLAGS: Record<string, SlotFlag> = {
    '11': { flagId: '11', flagName: 'Low Slot', esiPrefix: 'LoSlot', label: 'Low Slots', indexed: true },
    '19': { flagId: '19', flagName: 'Mid Slot', esiPrefix: 'MedSlot', label: 'Mid Slots', indexed: true },
    '27': { flagId: '27', flagName: 'High Slot', esiPrefix: 'HiSlot', label: 'High Slots', indexed: true },
    '92': { flagId: '92', flagName: 'Rig Slot', esiPrefix: 'RigSlot', label: 'Rig Slots', indexed: true },
    '125': { flagId: '125', flagName: 'Subsystem Slot', esiPrefix: 'SubSystemSlot', label: 'Subsystems', indexed: true },
    '164': { flagId: '164', flagName: 'Service Slot', esiPrefix: 'ServiceSlot', label: 'Service Slots', indexed: true },
    '87': { flagId: '87', flagName: 'Drone Bay', esiPrefix: 'DroneBay', label: 'Drone Bay', indexed: false },
    '158': { flagId: '158', flagName: 'Fighter Bay', esiPrefix: 'FighterBay', label: 'Fighter Bay', indexed: false },
    '89': { flagId: '89', flagName: 'Implant', esiPrefix: null, label: 'Implants', indexed: false },
    '5': { flagId: '5', flagName: 'Cargo', esiPrefix: 'Cargo', label: 'Cargo', indexed: false },
}

/**
 * EFT format section order (separated by blank lines in EFT text):
 * Low → Mid → High → Rigs → Subsystems → Drones → Cargo
 */
export const EFT_SECTION_ORDER = ['11', '19', '27', '92', '125', '87', '5'] as const

/**
 * Category-based slot overrides.
 * After initial section-based flag assignment, items are reclassified
 * based on their EVE category ID (e.g. drones always go to Drone Bay).
 */
export const CATEGORY_SLOT_OVERRIDES: Record<string, { flagId: string; flagName: string }> = {
    '18': { flagId: '87', flagName: 'Drone Bay' }, // Drones
    '87': { flagId: '158', flagName: 'Fighter Bay' }, // Fighters
    '20': { flagId: '89', flagName: 'Implant' }, // Implants
    '8': { flagId: '5', flagName: 'Cargo' }, // Charges → Cargo
}

/** EVE category ID for subsystems (used for subsystem detection in EFT parsing) */
export const CATEGORY_SUBSYSTEM = '32'
