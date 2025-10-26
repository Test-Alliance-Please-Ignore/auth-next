/**
 * Generate cryptographically secure random bytes using Web Crypto API
 * @param length - The number of random bytes to generate
 * @returns A Uint8Array of random bytes
 */
export function generateRandomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length)
	crypto.getRandomValues(bytes)
	return bytes
}

/**
 * Generate a random shard key in the range [min, max] (inclusive)
 * Uses Web Crypto API for cryptographically secure randomness
 * @param min - The minimum value (inclusive)
 * @param max - The maximum value (inclusive)
 * @returns A random integer in the range [min, max]
 */
export function generateShardKey(min: number, max: number): number {
	if (!Number.isInteger(min) || !Number.isInteger(max)) {
		throw new Error('min and max must be integers')
	}

	if (min > max) {
		throw new Error('min must be less than or equal to max')
	}

	if (min === max) {
		return min
	}

	// Calculate the range (inclusive)
	const range = max - min + 1

	// Use 4 bytes (32 bits) for the random number
	// This gives us a range of 0 to 4,294,967,295
	const randomBytes = new Uint8Array(4)
	crypto.getRandomValues(randomBytes)

	// Convert bytes to a number
	const randomValue =
		(randomBytes[0] << 24) | (randomBytes[1] << 16) | (randomBytes[2] << 8) | randomBytes[3]

	// Use modulo to get value in range [0, range)
	// Using unsigned right shift to ensure positive number
	const offset = (randomValue >>> 0) % range

	return min + offset
}
