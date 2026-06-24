import { describe, expect, it } from 'vitest'

import { formatSrpRequest } from '../lib/format-request'

describe('formatSrpRequest', () => {
	it('handles review/status mutation payloads without history preloaded', () => {
		const formatted = formatSrpRequest({
			id: '100001',
			userId: 'owner-1',
			characterId: '7002',
			characterName: 'Owner Character',
			corporationId: '123',
			corporationName: 'Corp',
			killmailHash: 'hash-123',
			lossDate: new Date('2026-01-01T00:00:00.000Z'),
			shipTypeId: '587',
			shipTypeName: 'Drake',
			shipValue: '1000000',
			requestStatus: 'approved',
			approvedAmount: '1000000',
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
			updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		})

		expect(formatted.id).toBe('100001')
		expect(formatted.requestStatus).toBe('approved')
		expect(formatted.history).toEqual([])
		expect(formatted.comments).toBeUndefined()
	})
})
