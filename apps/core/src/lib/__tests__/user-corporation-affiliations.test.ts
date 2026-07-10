import { describe, expect, it, vi } from 'vitest'

import {
	getUserCorporationAffiliationIds,
	hasUserCorporationAffiliation,
} from '../user-corporation-affiliations'

describe('user corporation affiliations helper', () => {
	it('returns distinct active corporation affiliations for a user', async () => {
		const db = {
			query: {
				userCharacters: {
					findMany: vi.fn().mockResolvedValue([
						{ corporationId: '1001' },
						{ corporationId: '1001' },
						{ corporationId: '2001' },
						{ corporationId: null },
						{ corporationId: '' },
					]),
				},
			},
		} as any

		await expect(getUserCorporationAffiliationIds(db, 'user-1')).resolves.toEqual(['1001', '2001'])
		expect(db.query.userCharacters.findMany).toHaveBeenCalledTimes(1)
	})

	it('detects whether a user is affiliated with a specific corporation', async () => {
		const db = {
			query: {
				userCharacters: {
					findMany: vi.fn().mockResolvedValue([{ corporationId: '1001' }]),
				},
			},
		} as any

		await expect(hasUserCorporationAffiliation(db, 'user-1', '1001')).resolves.toBe(true)
		await expect(hasUserCorporationAffiliation(db, 'user-1', '2001')).resolves.toBe(false)
	})
})
