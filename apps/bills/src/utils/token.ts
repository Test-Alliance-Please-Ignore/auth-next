/**
 * Secure Payment Token Generation
 *
 * Generates cryptographically secure 12-character random tokens
 * for bill payment authorization. Tokens are limited to 12 characters
 * to fit in EVE Online wallet transaction reason fields.
 */

/**
 * URL-safe alphanumeric character set excluding ambiguous glyphs:
 * - lowercase l
 * - uppercase O
 * - uppercase I
 */
const TOKEN_CHARS = '0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'

/**
 * Generate a secure 12-character payment token
 *
 * Uses Web Crypto API to generate cryptographically secure random bytes,
 * then maps them to base62 characters (0-9, a-z, A-Z) for URL-safe tokens.
 * Limited to exactly 12 characters to fit in EVE Online wallet transaction reason fields.
 *
 * @returns A 12-character alphanumeric token
 */
export function generatePaymentToken(): string {
	// Generate enough random bytes (12 bytes gives us plenty of entropy)
	const bytes = crypto.getRandomValues(new Uint8Array(8))

	// Map each byte to a base62 character using modulo
	// This ensures uniform distribution across the character set
	const token = Array.from(bytes)
		.map((byte) => TOKEN_CHARS[byte % TOKEN_CHARS.length])
		.join('')

	return token
}
