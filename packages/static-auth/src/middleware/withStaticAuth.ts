import type { Context, MiddlewareHandler } from 'hono'
import { WorkersLogger } from 'workers-tagged-logger'

const logger = new WorkersLogger()

export interface StaticAuthConfig {
	/**
	 * Comma-separated string of valid bearer tokens, or array of tokens
	 */
	tokens: string | string[]
	/**
	 * Custom error message for missing/invalid auth
	 */
	unauthorizedMessage?: string
	/**
	 * Custom error message for forbidden (invalid token)
	 */
	forbiddenMessage?: string
	/**
	 * Tag type for logging
	 */
	logTag?: string
}

/**
 * Middleware to authenticate requests using static bearer tokens.
 *
 * @example
 * ```ts
 * app.use('/admin/*', withStaticAuth({
 *   tokens: env.ADMIN_TOKENS // comma-separated string
 * }))
 * ```
 */
export function withStaticAuth(config: StaticAuthConfig): MiddlewareHandler {
	return async (c: Context, next) => {
		const authorization = c.req.header('Authorization')

		if (!authorization || !authorization.startsWith('Bearer ')) {
			logger
				.withTags({
					type: config.logTag || 'static_auth_missing',
				})
				.warn('Request missing authorization header', {
					path: c.req.path,
				})
			return c.json(
				{ error: config.unauthorizedMessage || 'Missing or invalid Authorization header' },
				401
			)
		}

		const token = authorization.substring(7)

		// Parse configured tokens
		const validTokens =
			typeof config.tokens === 'string'
				? config.tokens
						.split(',')
						.map((t) => t.trim())
						.filter((t) => t.length > 0)
				: config.tokens

		if (validTokens.length === 0) {
			logger
				.withTags({
					type: config.logTag || 'static_auth_not_configured',
				})
				.error('Static auth tokens not configured')
			return c.json({ error: 'Authentication not configured' }, 500)
		}

		// Verify token against configured tokens
		if (!validTokens.includes(token)) {
			logger
				.withTags({
					type: config.logTag || 'static_auth_invalid',
				})
				.warn('Invalid token provided', {
					path: c.req.path,
				})
			return c.json({ error: config.forbiddenMessage || 'Invalid token' }, 403)
		}

		logger
			.withTags({
				type: config.logTag || 'static_auth_success',
			})
			.info('Request authenticated', {
				path: c.req.path,
			})

		await next()
	}
}
