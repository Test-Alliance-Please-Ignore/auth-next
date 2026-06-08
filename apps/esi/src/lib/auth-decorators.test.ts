import { describe, expect, it, vi } from 'vitest'

import { UsePublicAuth } from './auth-decorators'

describe('UsePublicAuth', () => {
	it('clears authentication before and after public method execution', async () => {
		const clearAuthentication = vi.fn().mockResolvedValue(undefined)
		const calls: string[] = []

		const target = {
			esiFetcher: {
				clearAuthentication,
			},
		}

		const descriptor: PropertyDescriptor = {
			value: async function (this: typeof target) {
				calls.push('method')
				expect(clearAuthentication).toHaveBeenCalledTimes(1)
			},
		}

		UsePublicAuth({}, 'test', descriptor)

		await descriptor.value.call(target)

		expect(calls).toEqual(['method'])
		expect(clearAuthentication).toHaveBeenCalledTimes(2)
	})
})
