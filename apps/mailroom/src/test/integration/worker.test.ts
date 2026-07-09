import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import worker from '../../index'
import { makeMessage } from '../make-message'

import type { Env } from '../../context'

// `env` is populated from wrangler.jsonc vars + the vitest miniflare overrides.
const testEnv = env as unknown as Env

describe('mailroom worker (integration)', () => {
	it('serves the health endpoint', async () => {
		const ctx = createExecutionContext()
		const res = await worker.fetch!(new Request('http://mailroom/'), testEnv, ctx)
		await waitOnExecutionContext(ctx)
		expect(res.status).toBe(200)
		const body = (await res.json()) as { status: string; service: string }
		expect(body).toMatchObject({ status: 'ok', service: 'mailroom' })
	})

	it('rejects mail to an unknown recipient via the default policy', async () => {
		const ctx = createExecutionContext()
		const msg = makeMessage({ to: 'nobody@pleaseignore.app' })
		await worker.email!(msg, testEnv, ctx)
		await waitOnExecutionContext(ctx)
		expect(msg.setReject).toHaveBeenCalledTimes(1)
		expect(msg.forward).not.toHaveBeenCalled()
	})

	it('forwards a configured alias when its destination var is set', async () => {
		const ctx = createExecutionContext()
		const msg = makeMessage({ to: 'team@pleaseignore.app' })
		await worker.email!(msg, { ...testEnv, FORWARD_TEAM_TO: 'team-inbox@pleaseignore.app' }, ctx)
		await waitOnExecutionContext(ctx)
		expect(msg.forward).toHaveBeenCalledWith('team-inbox@pleaseignore.app', undefined)
		expect(msg.setReject).not.toHaveBeenCalled()
	})
})
