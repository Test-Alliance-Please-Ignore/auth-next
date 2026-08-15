import { Hono } from 'hono'

import { withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import { CorporationTaxDO } from './durable-object'
import { scheduledHandler } from './scheduled'
import { MockBills, MockDiscord, MockEveCharacterData, MockEveCorporationData } from './test-mocks'
import { TaxAssessmentWorkflow } from './workflows/tax-assessment.workflow'

import type { App, Env } from './context'

const app = new Hono<App>()
	.use('*', (c, next) =>
		withWorkersLogger(c.env.NAME, {
			environment: c.env.ENVIRONMENT,
			release: c.env.SENTRY_RELEASE,
		})(c, next)
	)
	.onError(withOnError())
	.notFound(withNotFound())
	.get('/', async (c) => {
		return c.text('Corporation Tax Durable Object Worker')
	})

export default {
	fetch: app.fetch.bind(app),
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		await scheduledHandler(event, env, ctx)
	},
}

export { CorporationTaxDO as CorporationTax }
export { TaxAssessmentWorkflow }
export { MockBills, MockDiscord, MockEveCharacterData, MockEveCorporationData }
