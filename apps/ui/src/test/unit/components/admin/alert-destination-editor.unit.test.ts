import { describe, expect, it } from 'vitest'

import {
	alertDestinationEditorRowFromDestination,
	createAlertDestinationEditorRow,
} from '@/components/admin/alert-destination-editor'

describe('alert destination editor helpers', () => {
	it('initializes webhook fields and hydrates webhook config from a destination', () => {
		const row = createAlertDestinationEditorRow('corp_application_submitted')

		expect(row).toEqual(
			expect.objectContaining({
				destinationType: 'discord_channel',
				webhookUrl: '',
			})
		)

		const hydrated = alertDestinationEditorRowFromDestination({
			id: 'dest-1',
			scopeType: 'corporation',
			scopeId: 'corp-1',
			alertType: 'corp_application_submitted',
			destinationType: 'discord_webhook',
			discordServerId: null,
			channelId: null,
			coreUserId: null,
			groupId: null,
			destinationConfig: {
				webhookUrl: 'https://discord.com/api/webhooks/123/abc',
			},
			isEnabled: true,
			createdBy: null,
			updatedBy: null,
			createdAt: '2026-06-11T00:00:00.000Z',
			updatedAt: '2026-06-11T00:00:00.000Z',
		})

		expect(hydrated).toEqual(
			expect.objectContaining({
				destinationType: 'discord_webhook',
				webhookUrl: 'https://discord.com/api/webhooks/123/abc',
			})
		)
	})
})
