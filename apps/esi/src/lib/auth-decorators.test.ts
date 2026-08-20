import { describe, expect, it, vi } from 'vitest'

import { UsePublicAuth } from './auth-decorators'

vi.mock('@repo/do-utils', () => ({ forDO: vi.fn() }))

describe('UsePublicAuth', () => {
	it('executes public methods within an isolated public context', async () => {
		const withPublicContext = vi.fn(async <T>(operation: () => Promise<T>) => await operation())
		const calls: string[] = []

		const target = {
			esiFetcher: {
				withPublicContext,
			},
		}

		const descriptor: PropertyDescriptor = {
			value: async function (this: typeof target) {
				calls.push('method')
				expect(withPublicContext).toHaveBeenCalledTimes(1)
			},
		}

		UsePublicAuth({}, 'test', descriptor)

		await descriptor.value.call(target)

		expect(calls).toEqual(['method'])
		expect(withPublicContext).toHaveBeenCalledTimes(1)
	})
})
