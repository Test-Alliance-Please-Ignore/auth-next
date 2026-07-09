import { describe, expect, it, vi } from 'vitest'

import {
	always,
	createEmailContext,
	EmailRouter,
	forward,
	recipientLocalPartIs,
	reject,
	sideEffect,
} from '../email'
import { fakeExecutionCtx, makeMessage } from './make-message'

import type { EmailLogger } from '../email'
import type { MakeMessageOptions } from './make-message'

const log: EmailLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const ctx = (options?: MakeMessageOptions) =>
	createEmailContext(makeMessage(options), {}, fakeExecutionCtx(), log)

describe('EmailRouter', () => {
	it('returns the first terminal disposition (first-match-wins)', async () => {
		const router = new EmailRouter()
			.on(recipientLocalPartIs('team'), () => forward('a@x.com'))
			.on(always(), () => forward('b@x.com'))
		expect(await router.route(ctx({ to: 'team@x.com' }))).toEqual({
			type: 'forward',
			to: 'a@x.com',
		})
	})

	it('continues past non-terminal (next) handlers', async () => {
		const effect = vi.fn()
		const router = new EmailRouter()
			.on(always(), sideEffect(effect))
			.on(always(), () => reject('done'))
		expect(await router.route(ctx())).toEqual({ type: 'reject', reason: 'done' })
		expect(effect).toHaveBeenCalledTimes(1)
	})

	it('applies the otherwise policy when nothing matches', async () => {
		const router = new EmailRouter()
			.on(recipientLocalPartIs('nope'), () => forward('x@x.com'))
			.otherwise(() => reject('no route'))
		expect(await router.route(ctx({ to: 'other@x.com' }))).toEqual({
			type: 'reject',
			reason: 'no route',
		})
	})

	it('defaults to a permanent reject when no otherwise is set', async () => {
		const result = await new EmailRouter().route(ctx())
		expect(result.type).toBe('reject')
	})

	it('is fail-open when a matcher throws (skips the route)', async () => {
		const router = new EmailRouter()
			.on(
				() => {
					throw new Error('bad matcher')
				},
				() => forward('should-not@x.com')
			)
			.on(always(), () => reject('safe'))
		expect(await router.route(ctx())).toEqual({ type: 'reject', reason: 'safe' })
	})

	it('treats a handler returning nothing as next', async () => {
		const router = new EmailRouter()
			.on(always(), () => undefined)
			.on(always(), () => forward('final@x.com'))
		expect(await router.route(ctx())).toEqual({ type: 'forward', to: 'final@x.com' })
	})
})
