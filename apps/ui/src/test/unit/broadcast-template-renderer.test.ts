import { describe, expect, it } from 'vitest'

import { renderBroadcastTemplateMessage } from '@/features/broadcasts/message-template-renderer'

describe('renderBroadcastTemplateMessage', () => {
	it('renders all system tokens with their provided values', () => {
		const rendered = renderBroadcastTemplateMessage(
			'Formup {{<doctrine>}} in {{<staging>}}\n{{<srp>}}',
			{
				doctrine: 'CFI',
				staging: 'MJ-5F9',
				srp: 'military',
				__srpToken: 'FleetStagingSystemFrontLine',
			}
		)

		expect(rendered).toBe(
			'Formup CFI in MJ-5F9\nSRP: **Military**\nSRP Token: **FleetStagingSystemFrontLine**'
		)
	})

	it('renders srp modes with bolded values and token', () => {
		const blanket = renderBroadcastTemplateMessage('{{srp}}', {
			srp: 'blanket',
			__srpToken: 'TokenA',
		})
		const military = renderBroadcastTemplateMessage('{{srp}}', {
			srp: 'military',
			__srpToken: 'TokenB',
		})
		const coalition = renderBroadcastTemplateMessage('{{srp}}', {
			srp: 'coalition',
			__srpToken: 'TokenC',
		})
		const disabled = renderBroadcastTemplateMessage('{{srp}}', {
			srp: 'disabled',
		})

		expect(blanket).toBe('SRP: **Blanket**\nSRP Token: **TokenA**')
		expect(military).toBe('SRP: **Military**\nSRP Token: **TokenB**')
		expect(coalition).toBe('SRP: **Coalition**')
		expect(disabled).toBe('SRP: **No**')
	})

	it('defaults unknown srp mode to blanket output', () => {
		const rendered = renderBroadcastTemplateMessage('{{srp}}', {
			srp: 'enabled',
			__srpToken: 'FallbackToken',
		})

		expect(rendered).toBe('SRP: **Blanket**\nSRP Token: **FallbackToken**')
	})

	it('treats non-select srp values as blanket', () => {
		const rendered = renderBroadcastTemplateMessage('{{srp}}', {
			srp: 'false',
			__srpToken: 'FallbackToken',
		})

		expect(rendered).toBe('SRP: **Blanket**\nSRP Token: **FallbackToken**')
	})

	it('renders canonical select token names', () => {
		const rendered = renderBroadcastTemplateMessage(
			'Doctrine: {{<select:engagementType:small_gang|strat-op>}}',
			{ 'select:engagementType': 'Small Gang' }
		)

		expect(rendered).toBe('Doctrine: Small Gang')
	})

	it('preserves placeholders in preview mode and strips in outbound mode', () => {
		const preview = renderBroadcastTemplateMessage(
			'Ping {{message}} from {{<doctrine>}} in {{<staging>}} [{{<select:engagementType:small_gang|strat-op>}}]',
			{},
			false
		)
		const outbound = renderBroadcastTemplateMessage(
			'Ping {{message}} from {{<doctrine>}} in {{<staging>}} [{{<select:engagementType:small_gang|strat-op>}}]',
			{},
			true
		)

		expect(preview).toBe('Ping {{message}} from {{<doctrine>}} in {{<staging>}} [{{<select:engagementType>}}]')
		expect(outbound).toBe('Ping  from  in  []')
	})
})
