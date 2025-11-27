/**
 * Convert a Uint8Array to a hex string
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * Hash a password using PBKDF2-HMAC with SHA-384
 * @param password - The plaintext password to hash
 * @param iterations - The number of PBKDF2 iterations to perform
 * @returns A tuple containing [hexHash, hexSalt, iterations]
 */
export async function hashPassword(
	password: string,
	iterations: number
): Promise<{ salt: string; hash: string; iterations: number }> {
	// Generate a 20-byte random salt
	const binSalt = crypto.getRandomValues(new Uint8Array(20))
	const hexSalt = uint8ArrayToHex(binSalt)

	// Encode the password as UTF-8
	const passwordData = new TextEncoder().encode(password)

	// Import the password as a key for PBKDF2
	const keyMaterial = await crypto.subtle.importKey('raw', passwordData, 'PBKDF2', false, [
		'deriveBits',
	])

	// Derive the hash using PBKDF2 with SHA-384
	const binHash = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: binSalt,
			iterations,
			hash: 'SHA-384',
		},
		keyMaterial,
		384 // SHA-384 produces 384 bits (48 bytes)
	)

	const hexHash = uint8ArrayToHex(new Uint8Array(binHash))

	return { salt: hexSalt, hash: hexHash, iterations }
}
