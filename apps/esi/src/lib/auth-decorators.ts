/**
 * Authentication decorators for ESI Durable Object methods.
 * Automatically authenticates with character or corporation before method execution.
 */

import { canonicalizeEsiEntityId } from '@repo/esi'

type EsiDOInstance = {
	esiFetcher: {
		withCharacterContext: <T>(characterId: string, operation: () => Promise<T>) => Promise<T>
		withCorporationContext: <T>(corporationId: string, operation: () => Promise<T>) => Promise<T>
		withPublicContext: <T>(operation: () => Promise<T>) => Promise<T>
	}
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
		const validatedCharacterId = canonicalizeEsiEntityId(characterId, 'character')
		return await this.esiFetcher.withCharacterContext(
			validatedCharacterId,
			async () => await originalMethod.apply(this, [validatedCharacterId, ...args])
		)
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
		const validatedCorporationId = canonicalizeEsiEntityId(corporationId, 'corporation')
		return await this.esiFetcher.withCorporationContext(
			validatedCorporationId,
			async () => await originalMethod.apply(this, [validatedCorporationId, ...args])
		)
	}

	return descriptor
}

/**
 * Decorator that executes a method in a public ESI context.
 */
export function UsePublicAuth(
	_target: unknown,
	_propertyKey: string,
	descriptor: PropertyDescriptor
): PropertyDescriptor {
	const originalMethod = descriptor.value

	descriptor.value = async function (this: EsiDOInstance, ...args: unknown[]) {
		return await this.esiFetcher.withPublicContext(
			async () => await originalMethod.apply(this, args)
		)
	}

	return descriptor
}
