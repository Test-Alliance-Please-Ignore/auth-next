import { describe, expect, it } from 'vitest'

import { BroadcastsDO } from './durable-object'

function createSubject(): any {
	return Object.create(BroadcastsDO.prototype) as BroadcastsDO
}

describe('BroadcastsDO template token rendering', () => {
	it('renders all system tokens with expected output', () => {
		const subject = createSubject()

		const rendered = subject.renderTemplate(
			'Formup {{<doctrine>}} in {{<staging>}}\n{{<srp>}}',
			{
				doctrine: 'CFI',
				staging: 'MJ-5F9',
				srp: 'coalition',
				__srpToken: 'FleetStagingSystemFrontLine',
			}
		)

		expect(rendered).toBe(
			'Formup CFI in MJ-5F9\nSRP: **Coalition**'
		)
	})

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

		const blanket = subject.renderTemplate('{{srp}}', {
			srp: 'blanket',
			__srpToken: 'FleetStagingSystemFrontLine',
		})
		const military = subject.renderTemplate('{{srp}}', {
			srp: 'military',
			__srpToken: 'FleetStagingSystemFrontLine',
		})
		const coalition = subject.renderTemplate('{{srp}}', {
			srp: 'coalition',
			__srpToken: 'FleetStagingSystemFrontLine',
		})
		const disabled = subject.renderTemplate('{{srp}}', { srp: 'disabled' })
		const nonSelectValue = subject.renderTemplate('{{srp}}', {
			srp: 'false',
			__srpToken: 'FleetStagingSystemFrontLine',
		})

		expect(blanket).toBe('SRP: **Blanket**\nSRP Token: **FleetStagingSystemFrontLine**')
		expect(military).toBe('SRP: **Military**\nSRP Token: **FleetStagingSystemFrontLine**')
		expect(coalition).toBe('SRP: **Coalition**')
		expect(disabled).toBe('SRP: **No**')
		expect(nonSelectValue).toBe('SRP: **Blanket**\nSRP Token: **FleetStagingSystemFrontLine**')
	})

	it('generates SRP token during send prep only for tokenized SRP modes', async () => {
		const subject = createSubject()
		subject.generateSrpFriendlyToken = () => 'GeneratedToken'
		subject.isSrpTokenAvailable = async () => true

		const enabled = await subject.prepareTemplateContentForSend('{{srp}}', { srp: 'blanket' })
		const coalition = await subject.prepareTemplateContentForSend('{{srp}}', { srp: 'coalition' })
		const disabled = await subject.prepareTemplateContentForSend('{{srp}}', { srp: 'disabled' })
		const noTokenInTemplate = await subject.prepareTemplateContentForSend('Ping {{message}}', {
			message: 'hello',
			srp: 'blanket',
		})

		expect(enabled.changed).toBe(true)
		expect(enabled.content.__srpToken).toBe('GeneratedToken')
		expect(coalition.changed).toBe(false)
		expect(coalition.content.__srpToken).toBeUndefined()
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

	it('rejects outbound messages exceeding discord content max length', () => {
		const subject = createSubject()

		expect(() => subject.ensureDiscordContentLimit('a'.repeat(2000))).not.toThrow()
		expect(() => subject.ensureDiscordContentLimit('a'.repeat(2001))).toThrow(
			'Discord maximum content length is 2000.'
		)
	})
})
