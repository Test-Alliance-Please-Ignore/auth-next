/**
 * Release a non-primitive value returned by Workers RPC after its contents have
 * been consumed. Plain test doubles do not have a disposer, so this is a safe
 * no-op outside the Workers RPC runtime.
 */
export function disposeRpcResult(result: unknown): void {
	if (result === null || (typeof result !== 'object' && typeof result !== 'function')) {
		return
	}

	const disposableResult = result as Record<PropertyKey, unknown>
	const symbolDisposer = disposableResult[Symbol.dispose]
	if (typeof symbolDisposer === 'function') {
		;(symbolDisposer as () => void).call(result)
		return
	}

	const disposer = disposableResult.dispose
	if (typeof disposer === 'function') {
		;(disposer as () => void).call(result)
	}
}

/**
 * Consume an RPC result and dispose it after the consumer has finished reading
 * it. This is the callback equivalent of `using result = await rpcCall()` and
 * remains compatible with plain unit-test mocks.
 */
export async function withRpcResult<T, R>(
	rpcCall: Promise<T>,
	consume: (result: T) => R | Promise<R>
): Promise<R> {
	const result = await rpcCall
	try {
		return await consume(result)
	} finally {
		disposeRpcResult(result)
	}
}
