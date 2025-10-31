/**
 * CSRF Protection Middleware
 *
 * Protects against Cross-Site Request Forgery attacks by requiring
 * a custom header on state-changing requests. Browsers do not allow
 * custom headers in simple CORS requests, preventing CSRF.
 *
 * This middleware should be applied to all API routes that perform
 * state-changing operations (POST, PUT, DELETE, PATCH).
 */

import type { Context, Next } from 'hono'
import type { App } from '../context'

/**
 * State-changing HTTP methods that require CSRF protection
 */
const STATE_CHANGING_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH']

/**
 * Required custom header name for CSRF protection
 */
const CSRF_HEADER = 'X-Requested-With'

/**
 * Expected header value
 */
const EXPECTED_HEADER_VALUE = 'XMLHttpRequest'

/**
 * CSRF protection middleware
 *
 * For state-changing requests (POST, PUT, DELETE, PATCH), requires
 * the X-Requested-With header to be set to 'XMLHttpRequest'.
 *
 * This protects against CSRF attacks because:
 * 1. Browsers do not allow custom headers in simple CORS requests
 * 2. An attacker cannot set this header from a malicious site
 * 3. Legitimate API clients (fetch, axios, etc.) can easily add this header
 *
 * Usage:
 * ```typescript
 * app.use('/api/*', csrfProtection())
 * ```
 */
export function csrfProtection() {
	return async (c: Context<App>, next: Next) => {
		const method = c.req.method.toUpperCase()

		// Only check state-changing requests
		if (STATE_CHANGING_METHODS.includes(method)) {
			const requestedWith = c.req.header(CSRF_HEADER)

			// Require the custom header to be present with expected value
			if (requestedWith !== EXPECTED_HEADER_VALUE) {
				return c.json(
					{
						error: 'CSRF protection: Missing or invalid X-Requested-With header',
					},
					403
				)
			}
		}

		// Header is valid or not required, continue
		return next()
	}
}
