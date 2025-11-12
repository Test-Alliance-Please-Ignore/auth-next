/**
 * Utility Functions for Doctrines Feature
 */

import type { Doctrine, DoctrinesByCategory, ParsedEFT } from './types'

/**
 * Group doctrines by category
 */
export function groupDoctrinesByCategory(doctrines: Doctrine[]): DoctrinesByCategory {
	return doctrines.reduce((acc, doctrine) => {
		if (!acc[doctrine.category]) {
			acc[doctrine.category] = []
		}
		acc[doctrine.category].push(doctrine)
		return acc
	}, {} as DoctrinesByCategory)
}

/**
 * Parse EFT (EVE Fitting Tool) format string
 * This is a simple client-side parser for preview purposes only
 * The actual parsing happens server-side
 */
export function parseEFTPreview(eftString: string): ParsedEFT | null {
	try {
		const lines = eftString
			.trim()
			.split('\n')
			.filter((line) => line.trim() !== '')

		if (lines.length < 2) {
			return null
		}

		// Parse header: [ShipName, FittingName]
		const headerMatch = lines[0].match(/^\[([^,]+),\s*([^\]]+)\]$/)
		if (!headerMatch) {
			return null
		}

		const shipName = headerMatch[1].trim()
		const fittingName = headerMatch[2].trim()

		const modules: string[] = []
		const cargo: Array<{ name: string; quantity: number }> = []

		// Parse items
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i].trim()

			// Skip empty slots
			if (line.startsWith('[Empty') || line.startsWith('[Subsystem')) {
				continue
			}

			// Match items with quantity (e.g., "Tremor S x1000")
			const quantityMatch = line.match(/^(.+)\s+x(\d+)$/)
			if (quantityMatch) {
				const itemName = quantityMatch[1].trim()
				const quantity = parseInt(quantityMatch[2], 10)
				cargo.push({ name: itemName, quantity })
			} else {
				// Fitted module (no quantity)
				modules.push(line)
			}
		}

		return {
			shipName,
			fittingName,
			modules,
			cargo,
		}
	} catch {
		return null
	}
}

/**
 * Format ISK values with thousand separators
 */
export function formatISK(value: string | number): string {
	const num = typeof value === 'string' ? parseFloat(value) : value
	if (isNaN(num)) return '0 ISK'

	return (
		num.toLocaleString('en-US', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		}) + ' ISK'
	)
}

/**
 * Validate EFT format
 */
export function validateEFT(eftString: string): { valid: boolean; error?: string } {
	if (!eftString || eftString.trim() === '') {
		return { valid: false, error: 'EFT string cannot be empty' }
	}

	const lines = eftString.trim().split('\n')
	if (lines.length < 2) {
		return { valid: false, error: 'EFT format requires at least a header and one item' }
	}

	// Check header format
	const headerMatch = lines[0].match(/^\[([^,]+),\s*([^\]]+)\]$/)
	if (!headerMatch) {
		return { valid: false, error: 'Invalid header format. Expected: [ShipName, FittingName]' }
	}

	return { valid: true }
}
