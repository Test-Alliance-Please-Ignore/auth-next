import { describe, expect, it, vi } from 'vitest'

import { disposeRpcResult, withRpcResult } from './rpc-result'

describe('RPC result lifecycle helpers', () => {
	it('disposes a result after consuming it', async () => {
		const dispose = vi.fn()
		const result = { value: 42, [Symbol.dispose]: dispose }

		await expect(withRpcResult(Promise.resolve(result), (value) => value.value)).resolves.toBe(42)
		expect(dispose).toHaveBeenCalledOnce()
	})

	it('disposes results when the consumer throws', async () => {
		const dispose = vi.fn()
		const result = { [Symbol.dispose]: dispose }

		await expect(
			withRpcResult(Promise.resolve(result), () => {
				throw new Error('consumer failed')
			})
		).rejects.toThrow('consumer failed')
		expect(dispose).toHaveBeenCalledOnce()
	})

	it('supports callable dispose methods and ignores primitives', () => {
		const dispose = vi.fn()

		disposeRpcResult({ dispose })
		disposeRpcResult(null)
		disposeRpcResult('value')

		expect(dispose).toHaveBeenCalledOnce()
	})
})
