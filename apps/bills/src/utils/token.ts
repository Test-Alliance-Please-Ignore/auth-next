/**
 * Secure Payment Token Generation
 *
 * Generates cryptographically secure 32-byte random tokens
 * for bill payment authorization.
 */

/**
 * Generate a secure 32-byte payment token with "tbt_" prefix
 *
 * Uses Web Crypto API to generate cryptographically secure random bytes,
 * then encodes as URL-safe base64 without padding.
 * Prefixed with "tbt_" (TAPI Bill Token) for easy identification.
 *
 * @returns A URL-safe base64-encoded 32-byte token prefixed with "tbt_"
 */
export function generatePaymentToken(): string {
	// Generate 32 random bytes
	const bytes = crypto.getRandomValues(new Uint8Array(32))

	// Convert to base64 and make URL-safe
	const base64 = btoa(String.fromCharCode(...bytes))

	// Make URL-safe by replacing characters and removing padding
	const token = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

	// Add prefix for easy identification and prefix matching
	return `tbt_${token}`
}
