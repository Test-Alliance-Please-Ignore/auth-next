import { honoIntegration, withSentry as sentrySdkWithSentry } from '@sentry/cloudflare'

import type { CloudflareOptions } from '@sentry/cloudflare'
import type { SharedHonoEnv } from '../types'

/**
 * Wrap a Hono app with Sentry error tracking
 * This should be called when exporting your worker
 *
 * @example
 * ```ts
 * const app = new Hono<App>()
 *   // ... define routes ...
 *
 * export default withSentry(app)
 * ```
 */
export function withSentry<E extends SharedHonoEnv>(app: any) {
	return sentrySdkWithSentry(
		(env: E): CloudflareOptions => ({
			dsn: env.SENTRY_DSN,
			environment: env.ENVIRONMENT,
			release: env.SENTRY_RELEASE,
			// Enable tracing
			tracesSampleRate: env.ENVIRONMENT === 'production' ? 0.1 : 1.0,
			// Filter out low-value errors
			beforeSend(event) {
				// Don't send 4xx client errors to Sentry
				if (event.contexts?.response?.status_code && event.contexts.response.status_code < 500) {
					return null
				}
				return event
			},
			integrations: [honoIntegration()],
		}),
		app
	)
}
