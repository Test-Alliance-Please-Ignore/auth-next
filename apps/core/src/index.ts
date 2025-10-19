import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import { sessionMiddleware } from './middleware/session'
import authRoutes from './routes/auth'
import charactersRoutes from './routes/characters'
import skillsRoutes from './routes/skills'
import usersRoutes from './routes/users'

import type { App } from './context'

const app = new Hono<App>()
	.use(
		'*',
		// middleware
		(c, next) =>
			useWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)

	// Session middleware - loads user into context if authenticated
	.use('*', sessionMiddleware())

	.onError(withOnError())
	.notFound(withNotFound())

	// Health check
	.get('/', async (c) => {
		return c.json({ status: 'ok', service: 'core' })
	})

	// API routes - mounted under /api prefix
	.route('/api/auth', authRoutes)
	.route('/api/users', usersRoutes)
	.route('/api/characters', charactersRoutes)
	.route('/api/skills', skillsRoutes)

export default app
