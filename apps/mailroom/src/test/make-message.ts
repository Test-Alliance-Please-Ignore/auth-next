import { vi } from 'vitest'

/** A fabricated `ForwardableEmailMessage` whose terminal methods are vi mocks. */
export type FakeEmailMessage = ForwardableEmailMessage & {
	setReject: ReturnType<typeof vi.fn>
	forward: ReturnType<typeof vi.fn>
	reply: ReturnType<typeof vi.fn>
}

export interface MakeMessageOptions {
	from?: string
	to?: string
	/** Raw MIME. Defaults to a minimal text message built from `from`/`to`/subject. */
	mime?: string
	/** Header overrides, merged over the defaults (e.g. `{ subject: '...' }`). */
	headers?: Record<string, string>
	/** Make `forward` reject, to exercise the error-fallback path. */
	forwardRejects?: boolean
}

/**
 * Build a complete, self-consistent fake inbound message for tests. `raw` is a fresh
 * single-use `ReadableStream` and `rawSize` is the byte length of the MIME string.
 */
export function makeMessage(options: MakeMessageOptions = {}): FakeEmailMessage {
	const from = options.from ?? 'alice@example.com'
	const to = options.to ?? 'team@pleaseignore.app'
	const subject = options.headers?.subject ?? 'Test subject'
	const mime =
		options.mime ??
		`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <test@example.com>\r\n\r\nHello, world.\r\n`
	const rawSize = new TextEncoder().encode(mime).byteLength

	return {
		from,
		to,
		headers: new Headers({ subject, ...options.headers }),
		raw: new Response(mime).body!,
		rawSize,
		setReject: vi.fn(),
		forward: options.forwardRejects
			? vi.fn(async () => {
					throw new Error('forward failed')
				})
			: vi.fn(async () => {}),
		reply: vi.fn(async () => {}),
	} as unknown as FakeEmailMessage
}

/** A throwaway `ExecutionContext` for handler tests. */
export function fakeExecutionCtx(): ExecutionContext {
	return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext
}
