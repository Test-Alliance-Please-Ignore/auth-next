import type { PasswordVerifier } from '@repo/mumble'

/**
 * PBKDF2 iteration count for generated verifiers.
 * Cloudflare Workers WebCrypto currently supports up to 100,000 iterations.
 */
export const VERIFIER_ITERATIONS = 100_000

const PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const PASSWORD_LENGTH = 24

/**
 * Convert a Uint8Array to a standard base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary)
}

/**
 * Generate a random base62 password.
 * Uses rejection sampling to avoid modulo bias.
 */
export function generatePassword(): string {
	const chars: string[] = []
	while (chars.length < PASSWORD_LENGTH) {
		const buf = crypto.getRandomValues(new Uint8Array(PASSWORD_LENGTH * 2))
		for (const byte of buf) {
			// Reject bytes outside the largest multiple of alphabet length (62 * 4 = 248)
			if (byte < 248) {
				chars.push(PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]!)
				if (chars.length === PASSWORD_LENGTH) break
			}
		}
	}
	return chars.join('')
}

/**
 * Create an imported password verifier for murmur-control.
 *
 * Contract requirements (INTEGRATION_CONTRACT.md):
 * - algorithm: pbkdf2-sha256
 * - hash: standard base64, decoding to exactly 32 bytes
 * - salt: standard base64, decoding to at least 16 bytes
 * - iterations: supported WebCrypto range for the runtime
 */
export async function createPasswordVerifier(
	password: string,
	iterations: number = VERIFIER_ITERATIONS
): Promise<PasswordVerifier> {
	const salt = crypto.getRandomValues(new Uint8Array(16))

	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	)

	const hashBits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt,
			iterations,
			hash: 'SHA-256',
		},
		keyMaterial,
		256 // 32 bytes
	)

	return {
		algorithm: 'pbkdf2-sha256',
		hash: uint8ArrayToBase64(new Uint8Array(hashBits)),
		salt: uint8ArrayToBase64(salt),
		iterations,
	}
}
