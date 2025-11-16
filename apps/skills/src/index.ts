import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import { SkillsDO } from './durable-object'

import type { Skills } from '@repo/skills'
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

	.onError(withOnError())
	.notFound(withNotFound())

	.get('/', async (c) => {
		return c.text('Skills Durable Object Worker')
	})

	.get('/skill/:skillId', async (c) => {
		// Example: Get skill information
		const skillId = c.req.param('skillId') as any // skillId from URL is string, Skills interface expects EveSkillId
		const stub = getStub<Skills>(c.env.SKILLS, 'default')

		const skillInfo = await stub.getSkillInfo(skillId)

		if (!skillInfo) {
			return c.json({ error: 'Skill not found' }, 404)
		}

		return c.json(skillInfo)
	})

export default app

// Export the Durable Object class
export { SkillsDO as Skills }
