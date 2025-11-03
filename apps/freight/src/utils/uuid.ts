/**
 * UUID v7 Generation
 *
 * UUID v7 provides time-ordered identifiers with millisecond precision.
 * Format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
 * - First 48 bits: Unix timestamp in milliseconds
 * - Next 12 bits: Random data
 * - Version field: 0111 (7)
 * - Variant field: 10
 * - Final 62 bits: Random data
 */

/**
 * Generate a UUID v7 identifier
 *
 * @returns A time-ordered UUID v7 string
 */
export function generateUuidV7(): string {
	// Get current timestamp in milliseconds
	const timestamp = Date.now()

	// Generate 16 random bytes
	const randomBytes = crypto.getRandomValues(new Uint8Array(16))

	// Set timestamp (48 bits) in first 6 bytes
	randomBytes[0] = (timestamp >> 40) & 0xff
	randomBytes[1] = (timestamp >> 32) & 0xff
	randomBytes[2] = (timestamp >> 24) & 0xff
	randomBytes[3] = (timestamp >> 16) & 0xff
	randomBytes[4] = (timestamp >> 8) & 0xff
	randomBytes[5] = timestamp & 0xff

	// Set version (4 bits) to 7
	randomBytes[6] = (randomBytes[6] & 0x0f) | 0x70

	// Set variant (2 bits) to 10
	randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80

	// Convert to hex string with dashes
	const hex = Array.from(randomBytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')

	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
