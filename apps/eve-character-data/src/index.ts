import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import { EveCharacterDataDO } from './durable-object'

import type { EveCharacterData } from '@repo/eve-character-data'
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
		return c.text('EveCharacterData Durable Object Worker')
	})

	.get('/example', async (c) => {
		// Example: Access the Durable Object
		const characterId = Number(c.req.query('characterId'))

		if (!characterId || isNaN(characterId)) {
			return c.json({ error: 'Invalid characterId parameter' }, 400)
		}

		const durableObject = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
		const characterInfo = await durableObject.getCharacterInfo(characterId)

		return c.json({ characterId, characterInfo })
	})

export default app

// Export the Durable Object class
export { EveCharacterDataDO as EveCharacterData }
