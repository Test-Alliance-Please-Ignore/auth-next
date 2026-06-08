/**
 * Authentication decorators for ESI Durable Object methods.
 * Automatically authenticates with character or corporation before method execution.
 */

type EsiDOInstance = {
	esiFetcher: {
		authenticateWithCharacter: (characterId: string) => Promise<void>
		authenticateWithCorporation: (corporationId: string) => Promise<void>
		clearAuthentication: () => Promise<void>
	}
}

function validateCharacterId(characterId: string | number): string {
	if (!characterId) {
		throw new Error('Character ID is required')
	}
	if (typeof characterId === 'number') {
		return String(characterId)
	}
	if (typeof characterId !== 'string') {
		throw new Error('Character ID must be a string or number got: ' + typeof characterId)
	}
	return characterId
}
/**
 * Decorator that authenticates with a character before method execution.
 * Expects the first parameter to be the characterId (string).
 */
export function UseCharacterAuth(
	_target: unknown,
	_propertyKey: string,
	descriptor: PropertyDescriptor
): PropertyDescriptor {
	const originalMethod = descriptor.value

	descriptor.value = async function (this: EsiDOInstance, characterId: string, ...args: unknown[]) {
		const validatedCharacterId = validateCharacterId(characterId)
		await this.esiFetcher.authenticateWithCharacter(validatedCharacterId)
		return originalMethod.apply(this, [characterId, ...args])
	}

	return descriptor
}

/**
 * Decorator that authenticates with a corporation before method execution.
 * Expects the first parameter to be the corporationId (string).
 */
export function UseCorporationAuth(
	_target: unknown,
	_propertyKey: string,
	descriptor: PropertyDescriptor
): PropertyDescriptor {
	const originalMethod = descriptor.value

	descriptor.value = async function (
		this: EsiDOInstance,
		corporationId: string,
		...args: unknown[]
	) {
		await this.esiFetcher.authenticateWithCorporation(corporationId)
		return originalMethod.apply(this, [corporationId, ...args])
	}

	return descriptor
}

/**
 * Decorator that clears authentication after method execution.
 * Useful for cleaning up authentication state after method completion.
 */
export function UsePublicAuth(
	_target: unknown,
	_propertyKey: string,
	descriptor: PropertyDescriptor
): PropertyDescriptor {
	const originalMethod = descriptor.value

	descriptor.value = async function (this: EsiDOInstance, ...args: unknown[]) {
		try {
			await this.esiFetcher.clearAuthentication()
			return await originalMethod.apply(this, args)
		} finally {
			await this.esiFetcher.clearAuthentication()
		}
	}

	return descriptor
}
