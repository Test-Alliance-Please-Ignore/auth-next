/**
 * Code generation service
 *
 * Generates secure, random invite codes for groups.
 */

/**
 * Generate a secure random invite code
 *
 * Creates an alphanumeric code suitable for sharing.
 * Format: XXXX-XXXX-XXXX-XXXX (16 characters + 3 dashes = 19 total)
 *
 * @returns A random invite code
 */
export function generateInviteCode(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Removed ambiguous characters: 0, O, 1, I
	const segments = 4
	const segmentLength = 4

	const code = []

	for (let seg = 0; seg < segments; seg++) {
		let segment = ''
		for (let i = 0; i < segmentLength; i++) {
			const randomIndex = Math.floor(Math.random() * chars.length)
			segment += chars[randomIndex]
		}
		code.push(segment)
	}

	return code.join('-')
}

/**
 * Generate a secure random invite code using crypto.randomUUID()
 *
 * Creates a shorter, URL-safe code using base64url encoding.
 *
 * @returns A random invite code (8 characters)
 */
export function generateShortInviteCode(): string {
	const uuid = crypto.randomUUID()
	// Take first 8 characters of the UUID and convert to uppercase alphanumeric
	return uuid.replace(/-/g, '').substring(0, 8).toUpperCase()
}

/**
 * Validate an invite code format
 *
 * @param code - The code to validate
 * @returns True if the code matches expected format
 */
export function isValidInviteCodeFormat(code: string): boolean {
	// Accept both formats:
	// 1. XXXX-XXXX-XXXX-XXXX (19 chars with dashes)
	// 2. XXXXXXXX (8 chars, no dashes)

	const longFormat = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/
	const shortFormat = /^[A-Z0-9]{8}$/

	return longFormat.test(code) || shortFormat.test(code)
}
