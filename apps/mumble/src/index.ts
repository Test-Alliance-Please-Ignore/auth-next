import { Hono } from 'hono'

import { MumbleDO } from './durable-object'

import type { App } from './context'

const app = new Hono<App>().get('/', async (c) => {
	return c.text('Mumble Durable Object Worker')
})

export default app

// Export Durable Object class
export { MumbleDO as Mumble }
