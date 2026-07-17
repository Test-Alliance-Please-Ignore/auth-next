import { describe, expect, it } from 'vitest'

import { getPrivateDataUnavailableMessage } from '../../../../client/features/applications/utils/private-data'

describe('getPrivateDataUnavailableMessage', () => {
	it('returns null when no error is present', () => {
		expect(getPrivateDataUnavailableMessage(null)).toBeNull()
		expect(getPrivateDataUnavailableMessage(undefined)).toBeNull()
	})

	it('returns the access explanation for forbidden responses', () => {
		expect(getPrivateDataUnavailableMessage({ status: 403 })).toBe(
			'Private ESI data is hidden because this user does not have an open application or shared corporation access for this character.'
		)
	})

	it('returns the generic explanation for other failures', () => {
		expect(getPrivateDataUnavailableMessage({ status: 500 })).toBe(
			'Private ESI data is unavailable right now.'
		)
	})
})
