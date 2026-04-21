import { describe, expect, it } from 'vitest'

import { BroadcastsDO } from './durable-object'

function createSubject(): any {
	return Object.create(BroadcastsDO.prototype) as BroadcastsDO
}

describe('BroadcastsDO template token rendering', () => {
	it('renders select token values from canonical select field names', () => {
		const subject = createSubject()

		const rendered = subject.renderTemplate(
			'Formup: {{<select:engagementType:small_gang|strat-op|home_defense>}}',
			{
				'select:engagementType': 'Home Defense',
			}
		)

		expect(rendered).toBe('Formup: Home Defense')
	})

	it('renders SRP token output when enabled and disabled', () => {
		const subject = createSubject()

		const enabled = subject.renderTemplate('{{srp}}', {
			srp: 'true',
			__srpToken: 'FleetStagingSystemFrontLine',
		})
		const disabled = subject.renderTemplate('{{srp}}', { srp: 'false' })

		expect(enabled).toBe('**SRP:** Yes\n**SRP Token:** FleetStagingSystemFrontLine')
		expect(disabled).toBe('**SRP:** No')
	})

	it('generates SRP token during send prep only when SRP is enabled in template', () => {
		const subject = createSubject()
		subject.generateSrpFriendlyToken = () => 'GeneratedToken'

		const enabled = subject.prepareTemplateContentForSend('{{srp}}', { srp: 'true' })
		const disabled = subject.prepareTemplateContentForSend('{{srp}}', { srp: 'false' })
		const noTokenInTemplate = subject.prepareTemplateContentForSend('Ping {{message}}', {
			message: 'hello',
			srp: 'true',
		})

		expect(enabled.changed).toBe(true)
		expect(enabled.content.__srpToken).toBe('GeneratedToken')
		expect(disabled.changed).toBe(false)
		expect(disabled.content.__srpToken).toBeUndefined()
		expect(noTokenInTemplate.changed).toBe(false)
		expect(noTokenInTemplate.content.__srpToken).toBeUndefined()
	})

	it('wraps message with frogsiren banner and required spacing', () => {
		const subject = createSubject()
		const wrapped = subject.wrapWithFrogsirenBanner('Broadcast body')
		const [top, body, bottom] = wrapped.split('\n\n')
		const emote = '<:fs:1496199804470952080>'

		expect(body).toBe('Broadcast body')
		expect(top).toBe(bottom)
		expect(top?.split(' ')).toHaveLength(16)
		expect(top?.split(' ').every((entry: string) => entry === emote)).toBe(true)
	})
})
