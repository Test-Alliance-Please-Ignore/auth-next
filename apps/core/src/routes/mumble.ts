import { Hono } from 'hono'

import { logger } from '@repo/hono-helpers'
import { parseMumbleError } from '@repo/mumble'
import { MUMBLE_FEATURE_FLAG_KEY } from '@repo/features'

import { isUserEligibleForServices } from '../lib/service-eligibility'
import { requireServiceEligibility } from '../middleware/service-eligibility'
import { requireAllianceMember } from '../middleware/session'
import { resolveFlag } from './flags'
import * as mumbleService from '../services/mumble.service'

import type { Context } from 'hono'
import type { App } from '../context'

/**
 * Mumble routes
 *
 * Voice account provisioning and credential management for authenticated
 * users. Account state lives in the external murmur-control control plane,
 * accessed via the mumble worker's Durable Object RPC.
 */
const mumble = new Hono<App>()
	.use('*', async (c, next) => {
		const enabled = await resolveFlag(c.env.FEATURES, MUMBLE_FEATURE_FLAG_KEY, false)
		if (!enabled) {
			return c.json({ error: 'Mumble feature is disabled' }, 404)
		}
		await next()
	})
	.use('*', requireAllianceMember())

/** Map typed mumble errors onto HTTP responses; returns null for unknown errors. */
function mumbleErrorResponse(c: Context<App>, error: unknown) {
	const parsed = parseMumbleError(error)
	if (!parsed) return null

	switch (parsed.code) {
		case 'already_exists':
			return c.json({ error: 'Mumble account already exists' }, 409)
		case 'login_name_taken':
			return c.json({ error: 'No available login name; contact an admin' }, 409)
		case 'not_found':
			return c.json({ error: 'Mumble account not found' }, 404)
		case 'busy':
			c.header('Retry-After', '5')
			return c.json({ error: 'Mumble service is busy, retry shortly' }, 429)
		default:
			logger.error('[Mumble] Control plane error', { code: parsed.code, message: parsed.message })
			return c.json({ error: 'Mumble service is unavailable' }, 502)
	}
}

function isRpcTransportLoss(error: unknown): boolean {
	return error instanceof Error && error.message.includes('Network connection lost')
}

/**
 * GET /api/mumble/account
 * Current user's Mumble account status plus connection info.
 *
 * Deliberately NOT gated on eligibility: an ineligible user must still be able to
 * see the state of their own account. `eligible` is reported so the client can
 * hide the create/reset affordances rather than offer a button that can only 403.
 */
mumble.get('/account', async (c) => {
	const user = c.get('user')!
	const db = c.get('db')

	// A read must not 500 just because the eligibility probe could not run; the
	// grant paths have their own fail-closed guard.
	const eligible = db ? await isUserEligibleForServices(db, user.id).catch(() => false) : false

	try {
		const account = await mumbleService.getMumbleAccount(c.env, user.id)
		return c.json({
			account,
			eligible,
			connection: mumbleService.getMumbleConnectionInfo(c.env),
		})
	} catch (error) {
		if (isRpcTransportLoss(error)) {
			logger.warn('[Mumble] Account read fell back to empty state', {
				userId: user.id,
				error: error instanceof Error ? error.message : String(error),
			})
			return c.json({
				account: null,
				eligible,
				connection: mumbleService.getMumbleConnectionInfo(c.env),
			})
		}
		const response = mumbleErrorResponse(c, error)
		if (response) return response
		throw error
	}
})

/**
 * POST /api/mumble/account
 * Provision a Mumble account for the current user.
 * Returns the one-time password — it is never stored or shown again.
 */
mumble.post('/account', requireServiceEligibility(), async (c) => {
	const user = c.get('user')!

	try {
		const { account, password } = await mumbleService.provisionMumbleAccount(c.env, user.id)
		logger.info('[Mumble] Provisioned account', { userId: user.id, loginName: account.loginName })
		return c.json(
			{
				account,
				password,
				connection: mumbleService.getMumbleConnectionInfo(c.env),
			},
			201
		)
	} catch (error) {
		const response = mumbleErrorResponse(c, error)
		if (response) return response
		throw error
	}
})

/**
 * POST /api/mumble/account/reset-password
 * Rotate the current user's Mumble password.
 * Returns the new one-time password — it is never stored or shown again.
 */
mumble.post('/account/reset-password', requireServiceEligibility(), async (c) => {
	const user = c.get('user')!

	try {
		const { password } = await mumbleService.resetMumblePassword(c.env, user.id)
		logger.info('[Mumble] Reset account password', { userId: user.id })
		return c.json({
			password,
			connection: mumbleService.getMumbleConnectionInfo(c.env),
		})
	} catch (error) {
		const response = mumbleErrorResponse(c, error)
		if (response) return response
		throw error
	}
})

export default mumble
