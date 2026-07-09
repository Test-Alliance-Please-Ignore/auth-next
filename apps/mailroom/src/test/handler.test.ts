import { describe, expect, it, vi } from 'vitest'

import { always, consume, createEmailHandler, EmailRouter, forward, reject } from '../email'
import { fakeExecutionCtx, makeMessage } from './make-message'

import type { FakeEmailMessage } from './make-message'

/** Count how many terminal SMTP actions were invoked on the message. */
function terminalActions(msg: FakeEmailMessage): number {
	return (
		msg.setReject.mock.calls.length + msg.forward.mock.calls.length + msg.reply.mock.calls.length
	)
}

describe('createEmailHandler — no-silent-drop invariant', () => {
	it('forwards for a forward disposition (exactly one terminal action)', async () => {
		const router = new EmailRouter().on(always(), () => forward('dest@x.com'))
		const msg = makeMessage()
		await createEmailHandler(router)(msg, {}, fakeExecutionCtx())
		expect(msg.forward).toHaveBeenCalledTimes(1)
		expect(msg.forward).toHaveBeenCalledWith('dest@x.com', undefined)
		expect(msg.setReject).not.toHaveBeenCalled()
		expect(terminalActions(msg)).toBe(1)
	})

	it('rejects for a reject disposition', async () => {
		const router = new EmailRouter().otherwise(() => reject('nope'))
		const msg = makeMessage()
		await createEmailHandler(router)(msg, {}, fakeExecutionCtx())
		expect(msg.setReject).toHaveBeenCalledTimes(1)
		expect(msg.setReject).toHaveBeenCalledWith('nope')
		expect(terminalActions(msg)).toBe(1)
	})

	it('takes NO terminal action for a consume disposition (deliberate discard)', async () => {
		const router = new EmailRouter().on(always(), () => consume)
		const msg = makeMessage()
		await createEmailHandler(router)(msg, {}, fakeExecutionCtx())
		expect(terminalActions(msg)).toBe(0)
	})

	it('forwards to the fallback mailbox when a handler throws', async () => {
		const router = new EmailRouter().on(always(), () => {
			throw new Error('handler boom')
		})
		const onError = vi.fn()
		const handler = createEmailHandler(router, {
			fallbackForwardAddress: () => 'ops@x.com',
			onError,
		})
		const msg = makeMessage()
		await handler(msg, {}, fakeExecutionCtx())
		expect(msg.forward).toHaveBeenCalledTimes(1)
		expect(msg.forward).toHaveBeenCalledWith('ops@x.com')
		expect(onError).toHaveBeenCalledTimes(1)
		expect(msg.setReject).not.toHaveBeenCalled()
		expect(terminalActions(msg)).toBe(1)
	})

	it('permanently rejects (last resort) when a handler throws and no fallback is configured', async () => {
		const router = new EmailRouter().on(always(), () => {
			throw new Error('boom')
		})
		const msg = makeMessage()
		await createEmailHandler(router)(msg, {}, fakeExecutionCtx())
		expect(msg.setReject).toHaveBeenCalledTimes(1)
		expect(msg.forward).not.toHaveBeenCalled()
	})

	it('falls back to a reject when both the primary and fallback forwards fail', async () => {
		const router = new EmailRouter().on(always(), () => forward('primary@x.com'))
		const handler = createEmailHandler(router, { fallbackForwardAddress: () => 'ops@x.com' })
		const msg = makeMessage({ forwardRejects: true })
		await handler(msg, {}, fakeExecutionCtx())
		expect(msg.forward).toHaveBeenCalled()
		expect(msg.setReject).toHaveBeenCalledTimes(1)
	})

	it('never throws even when every action fails', async () => {
		const router = new EmailRouter().on(always(), () => {
			throw new Error('boom')
		})
		const handler = createEmailHandler(router, { fallbackForwardAddress: () => 'ops@x.com' })
		const msg = makeMessage({ forwardRejects: true })
		await expect(handler(msg, {}, fakeExecutionCtx())).resolves.toBeUndefined()
		expect(msg.setReject).toHaveBeenCalled()
	})
})

describe('createEmailHandler — hardened against throwing injection points', () => {
	const throwingLogger = {
		info: () => {
			throw new Error('logger.info boom')
		},
		warn: () => {
			throw new Error('logger.warn boom')
		},
		error: () => {
			throw new Error('logger.error boom')
		},
	}

	it('still takes a terminal action when the onError callback throws', async () => {
		const router = new EmailRouter().on(always(), () => {
			throw new Error('handler boom')
		})
		const handler = createEmailHandler(router, {
			fallbackForwardAddress: () => 'ops@x.com',
			onError: () => {
				throw new Error('onError boom')
			},
		})
		const msg = makeMessage()
		await expect(handler(msg, {}, fakeExecutionCtx())).resolves.toBeUndefined()
		// onError threw, but the fallback forward still ran.
		expect(msg.forward).toHaveBeenCalledWith('ops@x.com')
		expect(terminalActions(msg)).toBe(1)
	})

	it('still takes a terminal action when the injected logger throws', async () => {
		const router = new EmailRouter().on(always(), () => {
			throw new Error('handler boom')
		})
		const handler = createEmailHandler(router, { logger: throwingLogger })
		const msg = makeMessage()
		await expect(handler(msg, {}, fakeExecutionCtx())).resolves.toBeUndefined()
		expect(msg.setReject).toHaveBeenCalledTimes(1)
	})

	it('falls back to a last-resort reject when the fallback resolver itself throws', async () => {
		const router = new EmailRouter().on(always(), () => {
			throw new Error('handler boom')
		})
		const handler = createEmailHandler(router, {
			fallbackForwardAddress: () => {
				throw new Error('resolver boom')
			},
		})
		const msg = makeMessage()
		await expect(handler(msg, {}, fakeExecutionCtx())).resolves.toBeUndefined()
		expect(msg.forward).not.toHaveBeenCalled()
		expect(msg.setReject).toHaveBeenCalledTimes(1)
	})

	it('still rejects a consume when the logger throws (no rethrow)', async () => {
		const router = new EmailRouter().on(always(), () => consume)
		const handler = createEmailHandler(router, { logger: throwingLogger })
		const msg = makeMessage()
		await expect(handler(msg, {}, fakeExecutionCtx())).resolves.toBeUndefined()
		// consume is a deliberate no-op even if logging fails — no terminal action, no throw.
		expect(terminalActions(msg)).toBe(0)
	})
})
