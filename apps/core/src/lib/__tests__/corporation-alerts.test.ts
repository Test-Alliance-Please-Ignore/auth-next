import { describe, expect, it } from 'vitest'

import { buildCorporationApplicationSubmittedMessage } from '../corporation-alerts'

describe('corporation alerts embed builder', () => {
	it('renders a first application alert with a single application link and alt count', () => {
		const message = buildCorporationApplicationSubmittedMessage({
			applicationId: 'app-123',
			corporationId: 'corp-456',
			corporationName: 'Rift Coalition',
			applicantCharacterId: 'char-789',
			applicantCharacterName: 'Pilot One',
			altCharacterCount: 2,
			isFirstApplication: true,
			submittedAt: '2026-06-11T12:00:00.000Z',
		})

		expect(message.content).toBe('')
		expect(message.embeds).toHaveLength(1)

		const embed = message.embeds?.[0]
		expect(embed).toMatchObject({
			title: 'New application to Rift Coalition submitted',
			description: '[View Application](https://pleaseignore.app/corporations/corp-456/applications/app-123)',
			thumbnail: {
				url: 'https://images.evetech.net/characters/char-789/portrait?size=256',
			},
			footer: {
				text: 'Submitted at 2026-06-11T12:00:00.000Z',
			},
			timestamp: '2026-06-11T12:00:00.000Z',
		})

		expect(embed?.fields).toEqual([
			{
				name: 'Applicant',
				value: 'Pilot One (+2 alts)',
				inline: true,
			},
			{
				name: 'Application Type',
				value: 'First application',
				inline: true,
			},
		])
	})

	it('renders repeat applications without alt suffix when none exist', () => {
		const message = buildCorporationApplicationSubmittedMessage({
			applicationId: 'app-999',
			corporationId: 'corp-456',
			corporationName: 'Rift Coalition',
			applicantCharacterId: 'char-789',
			applicantCharacterName: 'Pilot One',
			altCharacterCount: 0,
			isFirstApplication: false,
			submittedAt: '2026-06-11T12:00:00.000Z',
		})

		expect(message.embeds?.[0]?.fields).toEqual([
			{
				name: 'Applicant',
				value: 'Pilot One',
				inline: true,
			},
			{
				name: 'Application Type',
				value: 'Repeat application',
				inline: true,
			},
		])
	})
})

