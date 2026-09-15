import { afterEach, describe, expect, it } from 'vitest'

import { getPrivateDataUnavailableMessage } from '../../../../client/features/applications/utils/private-data'
import { setAppLocale } from '../../../../client/i18n'

afterEach(async () => {
	await setAppLocale('en', { persistLocal: false })
})

describe('getPrivateDataUnavailableMessage', () => {
	it('returns null when no error is present', () => {
		expect(getPrivateDataUnavailableMessage(null)).toBeNull()
		expect(getPrivateDataUnavailableMessage(undefined)).toBeNull()
	})

	it('returns the access explanation for forbidden responses', async () => {
		expect(getPrivateDataUnavailableMessage({ status: 403 })).toBe(
			'Private ESI data is hidden because this user does not have an open application or shared corporation access for this character.'
		)
		await setAppLocale('de', { persistLocal: false })
		expect(getPrivateDataUnavailableMessage({ status: 403 })).toContain('Private ESI-Daten')
	})

	it('returns the generic explanation for other failures', () => {
		expect(getPrivateDataUnavailableMessage({ status: 500 })).toBe(
			'Private ESI data is unavailable right now.'
		)
	})
})
