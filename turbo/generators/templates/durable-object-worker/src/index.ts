import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import type { App } from './context'
import { {{ pascalCase name }}DO } from './durable-object'

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

	.onError(withOnError())
	.notFound(withNotFound())

	.get('/', async (c) => {
		return c.text('{{ pascalCase name }} Durable Object Worker')
	})

	.get('/example', async (c) => {
		// Example: Access the Durable Object
		const id = c.req.query('id') ?? 'default'
		const stub = c.env.{{ constantCase name }}.idFromName(id)
		const durableObject = c.env.{{ constantCase name }}.get(stub)

		const result = await durableObject.exampleMethod('Hello from worker!')

		return c.json({ id, result })
	})

export default app

// Export the Durable Object class
export { {{ pascalCase name }}DO as {{ pascalCase name }} }
