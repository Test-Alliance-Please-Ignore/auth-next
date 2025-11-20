/**
 * JSON serialization utilities with safe handling of Date and BigInt types
 * All functions are pure and easily testable
 */

/**
 * JSON replacer function that handles Date and BigInt serialization
 * - Date objects are converted to ISO strings
 * - BigInt values are converted to strings
 */
export function jsonReplacer(key: string, value: unknown): unknown {
	// Convert BigInt to string
	if (typeof value === 'bigint') {
		return value.toString()
	}

	// Convert Date to ISO string
	if (value instanceof Date) {
		return value.toISOString()
	}

	return value
}

/**
 * Safely stringify data with Date and BigInt handling
 */
export function safeJsonStringify(data: unknown): string {
	return JSON.stringify(data, jsonReplacer)
}

/**
 * Parse JSON string
 * Note: Dates and BigInts will remain as strings after parsing
 */
export function safeJsonParse<T = unknown>(json: string): T {
	return JSON.parse(json) as T
}

/**
 * Calculate the byte size of JSON-serialized data
 * Pure function - no side effects
 */
export function calculateJsonSize(data: unknown): number {
	const json = safeJsonStringify(data)
	return new TextEncoder().encode(json).length
}

/**
 * Check if data should be stored in R2 based on size
 * Pure function - returns true if data exceeds 1 MiB
 */
export function shouldStoreInR2(sizeBytes: number): boolean {
	const ONE_MIB = 1024 * 1024
	return sizeBytes > ONE_MIB
}
