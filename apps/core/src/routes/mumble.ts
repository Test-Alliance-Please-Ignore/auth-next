import { Hono } from 'hono'

import { logger } from '@repo/hono-helpers'
import { parseMumbleError } from '@repo/mumble'

import { requireAuth } from '../middleware/session'
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

/**
 * GET /api/mumble/account
 * Current user's Mumble account status plus connection info.
 */
mumble.get('/account', requireAuth(), async (c) => {
	const user = c.get('user')!

	try {
		const account = await mumbleService.getMumbleAccount(c.env, user.id)
		return c.json({
			account,
			connection: mumbleService.getMumbleConnectionInfo(c.env),
		})
	} catch (error) {
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
mumble.post('/account', requireAuth(), async (c) => {
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
mumble.post('/account/reset-password', requireAuth(), async (c) => {
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
