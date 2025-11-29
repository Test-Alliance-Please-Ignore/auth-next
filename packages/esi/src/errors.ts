/**
 * ESI Error Classes
 *
 * Custom error types for specific ESI error conditions that require
 * special handling (e.g., non-retryable errors).
 */

/**
 * Error thrown when ESI indicates a character has been deleted.
 * This is a fatal error that should not be retried.
 *
 * Thrown when ESI returns 404 with message "Character has been deleted!"
 * This happens when a character has been biomassed or otherwise removed by CCP.
 */
export class CharacterDeletedError extends Error {
	public readonly characterId: string
	public readonly isFatal = true

	constructor(characterId: string) {
		super(`Character ${characterId} has been deleted`)
		this.name = 'CharacterDeletedError'
		this.characterId = characterId
	}
}
