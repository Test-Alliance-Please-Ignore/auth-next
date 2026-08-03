import { describe, expect, it } from 'vitest'

import { buildDiscordWebhookMessagePayload } from '@repo/discord'

import {
	buildTemporaryRolePanelMessage,
	parseTemporaryRolePanelAction,
	TEMPORARY_ROLE_PANEL_DEFAULT_MESSAGE,
	TEMPORARY_ROLE_PANEL_DEFAULT_TITLE,
} from '../temporary-role-panel'

describe('temporary role panel', () => {
	it('builds a non-mentioning panel with join and leave buttons', () => {
		const message = buildTemporaryRolePanelMessage()

		expect(message.allowEveryone).toBe(false)
		expect(message.embeds?.[0]?.title).toBe(TEMPORARY_ROLE_PANEL_DEFAULT_TITLE)
		expect(message.embeds?.[0]?.description).toBe(TEMPORARY_ROLE_PANEL_DEFAULT_MESSAGE)
		expect(message.components?.[0]?.components).toEqual([
			expect.objectContaining({ label: 'Join', custom_id: 'tmp-role-panel:join' }),
			expect.objectContaining({ label: 'Leave', custom_id: 'tmp-role-panel:leave' }),
		])
		expect(buildDiscordWebhookMessagePayload(message)).toMatchObject({
			components: message.components,
			allowed_mentions: { parse: [] },
		})
	})

	it('accepts custom panel instructions and rejects oversized content', () => {
		const message = buildTemporaryRolePanelMessage(' Custom title ', ' Custom instructions ')
		expect(message.embeds?.[0]?.title).toBe('Custom title')
		expect(message.embeds?.[0]?.description).toBe('Custom instructions')
		expect(() => buildTemporaryRolePanelMessage('x'.repeat(257))).toThrow('title')
		expect(() => buildTemporaryRolePanelMessage(undefined, 'x'.repeat(4001))).toThrow('description')
	})

	it('parses only known panel actions', () => {
		expect(parseTemporaryRolePanelAction('tmp-role-panel:join')).toBe('join')
		expect(parseTemporaryRolePanelAction('tmp-role-panel:leave')).toBe('leave')
		expect(parseTemporaryRolePanelAction('tmp-role-panel:unknown')).toBeNull()
	})
})
