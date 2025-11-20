/**
 * Data enrichment functions for character contacts
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import { getStub } from '@repo/do-utils'

import type { CharacterContact, EsiTypeResolver } from '@repo/esi'

/**
 * Enriched character contact with resolved names
 */
export interface ProcessedContact extends CharacterContact {
	contactName?: string
	standingFormatted?: string
	processedAt: string
}

/**
 * Array of processed contacts
 */
export type ProcessedContacts = ProcessedContact[]

/**
 * Format standing value with color coding
 * Positive numbers are blue (light to dark), negative numbers are red (light to dark)
 * Only exact 0.0 gets neutral grey
 *
 * @param standing - Standing value (-10 to +10)
 * @returns Formatted standing string with inline style for color
 */
function formatStanding(standing: number): string {
	const standingValue = Number(standing)
	
	// Exact 0 gets neutral grey
	if (standingValue === 0) {
		return '<span style="color: #808080;">0.0</span>'
	}

	// Positive values: light blue to dark blue (navy)
	if (standingValue > 0) {
		// Three control points: +1 = sky blue, +5 = blue, +10 = navy
		// Sky blue: #87CEEB = rgb(135, 206, 235)
		// Blue: #0000FF = rgb(0, 0, 255)
		// Navy: #000080 = rgb(0, 0, 128)
		
		let r: number, g: number, b: number
		
		if (standingValue <= 1) {
			// Clamp to sky blue for values <= 1
			r = 135
			g = 206
			b = 235
		} else if (standingValue >= 10) {
			// Clamp to navy for values >= 10
			r = 0
			g = 0
			b = 128
		} else if (standingValue <= 5) {
			// Interpolate between sky blue (+1) and blue (+5)
			const t = (standingValue - 1) / (5 - 1) // 0 to 1 as standing goes from 1 to 5
			r = Math.round(135 + (0 - 135) * t)
			g = Math.round(206 + (0 - 206) * t)
			b = Math.round(235 + (255 - 235) * t)
		} else {
			// Interpolate between blue (+5) and navy (+10)
			const t = (standingValue - 5) / (10 - 5) // 0 to 1 as standing goes from 5 to 10
			r = 0
			g = 0
			b = Math.round(255 + (128 - 255) * t)
		}
		
		const color = `rgb(${r}, ${g}, ${b})`
		return `<span style="color: ${color};">+${standingValue.toFixed(1)}</span>`
	}

	// Negative values: light red to dark red
	// Three control points: -1 = light red, -5 = red, -10 = dark red
	// Light red: #FFB6C1 = rgb(255, 182, 193)
	// Red: #FF0000 = rgb(255, 0, 0)
	// Dark red: #8B0000 = rgb(139, 0, 0)
	
	const absValue = Math.abs(standingValue)
	let r: number, g: number, b: number
	
	if (absValue <= 1) {
		// Clamp to light red for values >= -1
		r = 255
		g = 182
		b = 193
	} else if (absValue >= 10) {
		// Clamp to dark red for values <= -10
		r = 139
		g = 0
		b = 0
	} else if (absValue <= 5) {
		// Interpolate between light red (-1) and red (-5)
		const t = (absValue - 1) / (5 - 1) // 0 to 1 as absValue goes from 1 to 5
		r = 255
		g = Math.round(182 + (0 - 182) * t)
		b = Math.round(193 + (0 - 193) * t)
	} else {
		// Interpolate between red (-5) and dark red (-10)
		const t = (absValue - 5) / (10 - 5) // 0 to 1 as absValue goes from 5 to 10
		r = Math.round(255 + (139 - 255) * t)
		g = 0
		b = 0
	}
	
	const color = `rgb(${r}, ${g}, ${b})`
	return `<span style="color: ${color};">${standingValue.toFixed(1)}</span>`
}

/**
 * Enrich character contacts by resolving IDs to names
 * Uses ESI Type Resolver to batch resolve all contact IDs at once
 *
 * @param env - Worker environment with ESI_TYPE_RESOLVER binding
 * @param contacts - Character contacts from ESI worker
 * @param characterId - Character ID (for logging/debugging)
 * @returns Enriched contacts with resolved names and formatted standing
 */
export async function enrichContacts(
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace },
	contacts: CharacterContact[],
	characterId: string
): Promise<ProcessedContacts> {
	if (contacts.length === 0) {
		return []
	}

	// Collect all contact IDs that need resolution
	const contactIds = contacts.map((contact) => contact.contact_id).filter(Boolean)

	console.log('[enrichContacts] Starting enrichment', {
		totalContacts: contacts.length,
		uniqueContactIds: contactIds.length,
		sampleContactIds: contactIds.slice(0, 5),
	})

	// Batch resolve all contact IDs at once
	const nameMap: Record<string, string> = {}
	if (contactIds.length > 0) {
		try {
			const resolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
			const resolved = await resolver.resolveIds(contactIds)
			Object.assign(nameMap, resolved)
		} catch (error) {
			console.error('[enrichContacts] Failed to resolve contact IDs:', {
				error: error instanceof Error ? error.message : String(error),
				idCount: contactIds.length,
			})
		}
	}

	console.log('[enrichContacts] Resolution complete', {
		nameMapSize: Object.keys(nameMap).length,
		sampleResolved: Object.entries(nameMap).slice(0, 5),
	})

	// Build enriched contacts with resolved names and formatted standing
	const processedAt = new Date().toISOString()
	return contacts.map((contact) => {
		const contactName = nameMap[contact.contact_id]
		const standingFormatted = formatStanding(contact.standing)

		return {
			...contact,
			contactName,
			standingFormatted,
			processedAt,
		}
	})
}

