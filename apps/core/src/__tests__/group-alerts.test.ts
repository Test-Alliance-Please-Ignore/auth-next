import { describe, expect, it } from 'vitest'

import {
	buildGroupApplicationSubmittedMessage,
	buildGroupInvitationMessage,
} from '../lib/group-alerts'

describe('group alerts message builders', () => {
	it('builds the group application submitted embed', () => {
		const message = buildGroupApplicationSubmittedMessage({
			groupId: 'group-1',
			groupName: 'Fleet Ops',
			applicantCharacterId: '12345',
			applicantCharacterName: 'Pilot One',
			applicationNote: 'Please let me in.',
			submittedAt: new Date('2026-06-16T12:00:00.000Z'),
		})

		expect(message.embeds?.[0]).toMatchObject({
			title: 'New application for Fleet Ops',
			description: '[Review group](https://pleaseignore.app/groups/group-1)',
			thumbnail: {
				url: 'https://images.evetech.net/characters/12345/portrait?size=256',
			},
			fields: [
				{ name: 'Applicant', value: 'Pilot One', inline: true },
				{ name: 'Group', value: 'Fleet Ops', inline: true },
				{ name: 'Application Note', value: 'Please let me in.', inline: false },
			],
			footer: {
				text: 'Group application notice',
			},
			timestamp: '2026-06-16T12:00:00.000Z',
		})
	})

	it('builds the group invitation embed', () => {
		const message = buildGroupInvitationMessage({
			groupId: 'group-1',
			groupName: 'Fleet Ops',
			invitationId: 'inv-1',
			inviterCharacterName: 'Fleet Boss',
			createdAt: new Date('2026-06-16T12:00:00.000Z'),
		})

		expect(message.embeds?.[0]).toMatchObject({
			title: 'You have a new invitation to Fleet Ops',
			description: '[View invitations](https://pleaseignore.app/invitations)',
			fields: [
				{ name: 'Group', value: 'Fleet Ops', inline: true },
				{ name: 'Invited By', value: 'Fleet Boss', inline: true },
			],
			footer: {
				text: 'Invitation inv-1',
			},
			timestamp: '2026-06-16T12:00:00.000Z',
		})
	})
})
