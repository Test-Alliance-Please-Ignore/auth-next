import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	canonicalizeEsiEntityId,
	ESI_AUTH_SHARD_COUNT,
	ESI_AUTH_SHARD_PREFIX,
	getEsiInstanceForCharacter,
	getEsiInstanceForCorporation,
	getPublicEsiInstance,
} from '../index'

const { forDO, forKey, sharded, singleton } = vi.hoisted(() => {
	const singleton = vi.fn()
	const forKey = vi.fn()
	const sharded = vi.fn(() => ({ forKey }))
	const forDO = vi.fn(() => ({ singleton, sharded }))
	return { forDO, forKey, sharded, singleton }
})

vi.mock('@repo/do-utils', () => ({ forDO }))

function createNamespace() {
	return {
		get: vi.fn(),
		getByName: vi.fn(),
		jurisdiction: vi.fn(),
	} as unknown as DurableObjectNamespace
}

describe('ESI Durable Object routing', () => {
	it('keeps the authenticated shard contract frozen', () => {
		expect(ESI_AUTH_SHARD_COUNT).toBe(16)
		expect(ESI_AUTH_SHARD_PREFIX).toBe('esi-auth')
	})

	it('routes public requests to the singleton', () => {
		const namespace = createNamespace()

		getPublicEsiInstance(namespace)

		expect(forDO).toHaveBeenCalledWith(namespace)
		expect(singleton).toHaveBeenCalledOnce()
	})

	it('routes canonical character and corporation identities to fixed shards', () => {
		const namespace = createNamespace()

		getEsiInstanceForCharacter(namespace, ' 2123456789 ')
		getEsiInstanceForCorporation(namespace, '987654321')

		expect(sharded).toHaveBeenNthCalledWith(1, {
			shards: ESI_AUTH_SHARD_COUNT,
			prefix: ESI_AUTH_SHARD_PREFIX,
		})
		expect(forKey).toHaveBeenNthCalledWith(1, 'character:2123456789')
		expect(sharded).toHaveBeenNthCalledWith(2, {
			shards: ESI_AUTH_SHARD_COUNT,
			prefix: ESI_AUTH_SHARD_PREFIX,
		})
		expect(forKey).toHaveBeenNthCalledWith(2, 'corporation:987654321')
	})

	it.each([
		['character', getEsiInstanceForCharacter],
		['corporation', getEsiInstanceForCorporation],
	] as const)('rejects invalid %s routing IDs', (_entityType, getInstance) => {
		const namespace = createNamespace()

		expect(() => getInstance(namespace, ' character:123 ')).toThrow(TypeError)
		expect(() => getInstance(namespace, '0')).toThrow(TypeError)
		expect(() => getInstance(namespace, '-1')).toThrow(TypeError)
	})

	it('canonicalizes only valid positive EVE IDs', () => {
		expect(canonicalizeEsiEntityId(' 2123456789 ', 'character')).toBe('2123456789')
		expect(canonicalizeEsiEntityId(987654321, 'corporation')).toBe('987654321')
		expect(() => canonicalizeEsiEntityId(1.5, 'character')).toThrow(TypeError)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})
})
