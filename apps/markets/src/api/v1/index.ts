import { Hono } from 'hono'

import { withDatabaseAuth } from '../../middleware/auth'
import { withCors } from '../../middleware/cors'
import { withCache } from '../../utils/cache'
import { pricesRouter } from './prices'
import { refreshRouter } from './refresh'
import { snapshotsRouter } from './snapshots'

import type { App } from '../../context'

const v1Router = new Hono<App>()

// Apply middleware stack to all v1 endpoints
v1Router.use('*', withCors) // CORS for public API
v1Router.use('*', withDatabaseAuth) // Database-based authentication
v1Router.use('*', withCache()) // Cloudflare Cache API

// Mount endpoint routers
v1Router.route('/locations', pricesRouter)
v1Router.route('/locations', snapshotsRouter)
v1Router.route('/locations', refreshRouter)

export { v1Router }
