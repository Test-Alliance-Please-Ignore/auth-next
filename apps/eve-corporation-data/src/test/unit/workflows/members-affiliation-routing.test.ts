import { describe, expect, it, vi } from 'vitest'

import { sendMembershipChangedMessages } from '../../../workflows/steps/members'

vi.mock('../../../workflows/utils/services', () => ({
	createTokenStore: vi.fn(),
	getCorporationDataStub: vi.fn(),
}))

describe('members step affiliation routing', () => {
	it('routes membership changes to Core unified affiliation handler', async () => {
		const handleCharacterAffiliationChanges = vi.fn().mockResolvedValue(undefined)
		const env = {
			CORE: {
				handleCharacterAffiliationChanges,
			},
		} as any

		await sendMembershipChangedMessages(env, '98000001', ['100', '101'])

		expect(handleCharacterAffiliationChanges).toHaveBeenCalledWith(['100', '101'], {
			source: 'corp-membership-changed',
			bypassThrottle: true,
		})
	})

	it('skips Core calls when there are no changed members', async () => {
		const handleCharacterAffiliationChanges = vi.fn().mockResolvedValue(undefined)
		const env = {
			CORE: {
				handleCharacterAffiliationChanges,
			},
		} as any

		await sendMembershipChangedMessages(env, '98000001', [])

		expect(handleCharacterAffiliationChanges).not.toHaveBeenCalled()
	})
})
