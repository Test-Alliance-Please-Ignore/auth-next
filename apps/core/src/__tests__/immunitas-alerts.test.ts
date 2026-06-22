import { describe, expect, it } from 'vitest'

import { buildImmunitasAccessAlertMessage } from '../lib/immunitas-alerts'

describe('immunitas alerts message builder', () => {
	it('groups requestors by accessor user in the attempted by field', () => {
		const message = buildImmunitasAccessAlertMessage({
			accessType: 'profile-data',
			targetCharacterLabels: ['Target Pilot One', 'Target Pilot Two'],
			requestorGroups: [
				{
					requestorUserId: 'requestor-1',
					requestorLabels: ['Requester Alpha', 'Requester Alpha Alt'],
					attemptCount: 2,
				},
				{
					requestorUserId: 'requestor-2',
					requestorLabels: ['Requester Beta'],
					attemptCount: 1,
				},
			],
			attemptCount: 3,
			updatedAt: new Date('2026-06-21T00:00:00.000Z'),
		})

		expect(message.embeds?.[0]).toMatchObject({
			title: 'Unauthorized profile data access blocked',
			timestamp: '2026-06-21T00:00:00.000Z',
		})
		expect(message.embeds?.[0]?.fields?.[2]?.name).toBe('Attempted By')
		expect(message.embeds?.[0]?.fields?.[2]?.value).toContain(
			'• Requester Alpha (2 blocked attempts)'
		)
		expect(message.embeds?.[0]?.fields?.[2]?.value).toContain('  - Requester Alpha Alt')
		expect(message.embeds?.[0]?.fields?.[2]?.value).toContain(
			'• Requester Beta (1 blocked attempt)'
		)
	})
})
