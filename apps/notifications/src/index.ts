import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import {
	NotificationTransportExecutor,
	NotificationTransportRegistryImpl,
} from '@repo/notifications'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import { createDb } from './db'
import { NotificationsDO } from './durable-object'
import { NotificationConfigService } from './services/notification-config'

import type { App } from './context'

// Initialize transport registry and executor
// Transports will be registered here when transport packages are added
// Example:
// import { register as registerDiscord } from '@repo/notification-transport-discord'
// import { register as registerEmail } from '@repo/notification-transport-email'

function createTransportExecutor(env: App['Bindings']) {
	const transportRegistry = new NotificationTransportRegistryImpl()

	// Register all transports (each package registers all its internal transport types)
	// Example:
	// registerDiscord(transportRegistry, env)
	// registerEmail(transportRegistry, env)

	const configService = new NotificationConfigService(createDb(env.DATABASE_URL))

	return new NotificationTransportExecutor(
		transportRegistry,
		configService,
		env
	)
}

const app = new Hono<App>()
	.use('*', (c, next) =>
		useWorkersLogger(c.env.NAME, {
			environment: c.env.ENVIRONMENT,
			release: c.env.SENTRY_RELEASE,
		})(c, next)
	)
	.use('*', async (c, next) => {
		// Initialize transport executor and attach to env for Durable Object access
		if (!c.env.transportExecutor) {
			c.env.transportExecutor = createTransportExecutor(c.env)
		}
		await next()
	})
	.onError(withOnError())
	.notFound(withNotFound())
	.get('/', async (c) =>
		c.json({
			status: 'ok',
			service: 'notifications',
			version: c.env.SENTRY_RELEASE || 'dev',
		})
	)

export default app

// Export the Durable Object class
export { NotificationsDO as Notifications }
