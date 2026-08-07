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
	// `Symbol.dispose` is an optional runtime capability and is not included in
	// the lib target of every package that consumes this shared source file.
	const symbolDispose = Reflect.get(Symbol, 'dispose')
	if (typeof symbolDispose === 'symbol') {
		const symbolDisposer = disposableResult[symbolDispose]
		if (typeof symbolDisposer === 'function') {
			;(symbolDisposer as () => void).call(result)
			return
		}
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
