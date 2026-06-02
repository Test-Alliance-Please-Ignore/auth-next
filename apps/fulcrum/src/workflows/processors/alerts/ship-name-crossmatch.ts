/**
 * Ship Name Cross-Match Alert
 *
 * Checks if any ships have custom names that match real EVE character names.
 * Excludes matches against sibling characters on the same account (those are fine).
 *
 * The caller must resolve names via POST /universe/ids/ first and pass in
 * only the confirmed character matches.
 *
 * Severity: medium (ship named after a real character that isn't the owner or their alts)
 */

import type { FittedShip } from '../helpers/ships'
import type { AssetNameMap } from '../../steps/assets/fetch-asset-names'
import type { ReportAlert } from './types'

export interface ResolvedCharacter {
    name: string
    characterId: number
}

/**
 * Check if the "ship" part of a custom name relates to the actual ship type.
 * Returns true if any significant word (3+ chars) from the candidate part
 * appears in the ship type name or vice versa.
 */
function shipPartMatchesType(shipPart: string, shipTypeName: string): boolean {
    const shipPartWords = shipPart.toLowerCase().split(/\s+/)
    const typeWords = shipTypeName.toLowerCase().split(/\s+/)
    return shipPartWords.some((w) =>
        w.length >= 3 && typeWords.some((tw) => tw.length >= 3 && (tw.startsWith(w) || w.startsWith(tw))),
    )
}

/**
 * Collect unique custom ship names from fitted ships and the asset name map.
 * Filters out names that match the ship type name (i.e. not actually renamed).
 */
export function collectCustomShipNames(
    assetNameMap: AssetNameMap,
    fittedShips: FittedShip[],
): Map<string, { shipTypeName: string; customName: string }> {
    const customNames = new Map<string, { shipTypeName: string; customName: string }>()

    for (const ship of fittedShips) {
        if (ship.customName) {
            const nameLower = ship.customName.toLowerCase().trim()
            if (nameLower !== ship.shipName.toLowerCase()) {
                customNames.set(nameLower, {
                    shipTypeName: ship.shipName,
                    customName: ship.customName,
                })
            }
        }
    }

    // Also include any names in the map that aren't already from fitted ships
    for (const [, name] of Object.entries(assetNameMap)) {
        const nameLower = name.toLowerCase().trim()
        if (!customNames.has(nameLower)) {
            customNames.set(nameLower, {
                shipTypeName: 'Unknown Ship',
                customName: name,
            })
        }
    }

    return customNames
}

/**
 * Extract candidate character names from custom ship names by looking for
 * common naming patterns that indicate a ship was named after a character:
 *
 * - "<ShipType> - <CharacterName>" (dash separator, e.g. "Minmatar Shuttle - Vespida")
 *   The part before the dash must match the actual ship type name.
 * - "<CharacterName>'s <ShipType>" (possessive, e.g. "Jericho StormCloud's Reaper")
 *   The part after the 's must match the actual ship type name.
 */
export function extractCandidateCharacterNames(
    customNames: Map<string, { shipTypeName: string; customName: string }>,
): { namesToResolve: string[]; candidateToCustomName: Map<string, string> } {
    // Maps lowercase candidate → lowercase custom name key (from the customNames map)
    const candidateToCustomName = new Map<string, string>()
    const namesToResolve = new Set<string>()

    for (const [customNameLower, info] of customNames) {
        const name = info.customName.trim()

        // Pattern 1: "<ShipType> - <CharacterName>" (dash separator)
        // The left side must relate to the actual ship type name
        const dashMatch = name.match(/^(.+?)\s+-\s+(.+)$/)
        if (dashMatch) {
            const shipPart = dashMatch[1].trim()
            const candidate = dashMatch[2].trim()
            if (candidate.length >= 3 && shipPartMatchesType(shipPart, info.shipTypeName)) {
                namesToResolve.add(candidate)
                candidateToCustomName.set(candidate.toLowerCase(), customNameLower)
            }
            continue
        }

        // Pattern 2: "<CharacterName>'s <ShipType>" (possessive with straight or curly apostrophe)
        // The right side must relate to the actual ship type name
        const possessiveMatch = name.match(/^(.+?)[''\u2019]s\s+(.+)$/i)
        if (possessiveMatch) {
            const candidate = possessiveMatch[1].trim()
            const shipPart = possessiveMatch[2].trim()
            if (candidate.length >= 2 && shipPartMatchesType(shipPart, info.shipTypeName)) {
                namesToResolve.add(candidate)
                candidateToCustomName.set(candidate.toLowerCase(), customNameLower)
            }
            continue
        }
    }

    return {
        namesToResolve: [...namesToResolve],
        candidateToCustomName,
    }
}

/**
 * Check for ships named after real EVE characters.
 *
 * @param customNames - Map of lowercase name → ship info (from collectCustomShipNames)
 * @param resolvedCharacters - Names confirmed as real characters via POST /universe/ids/
 * @param candidateToCustomName - Mapping from candidate name (lowercase) → custom name key (lowercase)
 * @param characterName - Name of the report subject (excluded from matches)
 * @param siblingCharacterNames - Names of other characters on the same account (excluded)
 */
export function checkShipNameCrossmatch(
    customNames: Map<string, { shipTypeName: string; customName: string }>,
    resolvedCharacters: ResolvedCharacter[],
    candidateToCustomName: Map<string, string>,
    characterName: string,
    siblingCharacterNames: string[],
): ReportAlert | null {
    if (resolvedCharacters.length === 0 || customNames.size === 0) {
        return null
    }

    // Build exclusion set: the character's own name + sibling names (case-insensitive)
    const excludedNames = new Set<string>([
        characterName.toLowerCase(),
        ...siblingCharacterNames.map((n) => n.toLowerCase()),
    ])

    // Match resolved characters against custom ship names, excluding self/siblings
    const matches: Array<{ shipType: string; customName: string; characterId: number; matchedName: string }> = []

    for (const resolved of resolvedCharacters) {
        const nameLower = resolved.name.toLowerCase()

        // Skip if this is the character themselves or a sibling
        if (excludedNames.has(nameLower)) {
            continue
        }

        // Map the resolved candidate back to the original custom ship name
        const customNameKey = candidateToCustomName.get(nameLower)
        if (!customNameKey) continue

        const shipInfo = customNames.get(customNameKey)
        if (shipInfo) {
            matches.push({
                shipType: shipInfo.shipTypeName,
                customName: shipInfo.customName,
                characterId: resolved.characterId,
                matchedName: resolved.name,
            })
        }
    }

    if (matches.length === 0) {
        return null
    }

    return {
        id: 'ship-name-crossmatch',
        type: 'ship-name-crossmatch',
        severity: 'medium',
        title: 'Ships Named After Real Characters',
        description: `${matches.length} ship${matches.length !== 1 ? 's' : ''} found with names matching real EVE characters (excluding known alts).`,
        details: {
            matches,
            totalCustomNamedShips: customNames.size,
            excludedSiblingNames: siblingCharacterNames,
        },
        surfaceSections: ['assets', 'fitted-ships'],
    }
}
