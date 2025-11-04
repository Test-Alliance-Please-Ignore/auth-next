/**
 * Cursor-based pagination utilities
 * Uses base64 encoded JSON for cursor data
 */

export interface CursorData {
	id: string
	[key: string]: unknown
}

/**
 * Encode pagination cursor (base64 JSON)
 */
export function encodeCursor(data: CursorData): string {
	const json = JSON.stringify(data)
	return btoa(json)
}

/**
 * Decode pagination cursor
 * @throws Error if cursor is invalid
 */
export function decodeCursor(cursor: string): CursorData {
	try {
		const json = atob(cursor)
		const data = JSON.parse(json)

		if (!data || typeof data !== 'object' || !data.id) {
			throw new Error('Invalid cursor format')
		}

		return data
	} catch (error) {
		throw new Error('Invalid pagination cursor')
	}
}

/**
 * Create pagination metadata for response
 */
export function createPaginationMeta(
	total: number,
	limit: number,
	lastItem: { id: string; [key: string]: unknown } | null
) {
	return {
		total,
		limit,
		cursor: lastItem ? encodeCursor({ id: lastItem.id }) : null,
	}
}
