import { describe, expect, it } from 'vitest'

import { getMoonScanPermissionState } from '@/features/moon-scan/permissions'

describe('moon scan permission state', () => {
	it('reflects the moon-scan permission cascade', () => {
		const noneState = getMoonScanPermissionState([], false)
		expect(noneState).toMatchObject({
			canSubmit: false,
			canValidate: false,
			canView: false,
			canLeaderboard: false,
			canAccessMoonScan: false,
			canAdmin: false,
		})

		const submitState = getMoonScanPermissionState([{ urn: 'urn:moons:scan:submit' }], false)
		expect(submitState).toMatchObject({
			canSubmit: true,
			canValidate: false,
			canView: false,
			canLeaderboard: true,
			canAccessMoonScan: true,
			canAdmin: false,
		})

		const validateState = getMoonScanPermissionState([{ urn: 'urn:moons:scan:validate' }], false)
		expect(validateState).toMatchObject({
			canSubmit: true,
			canValidate: true,
			canView: true,
			canLeaderboard: true,
			canAccessMoonScan: true,
			canAdmin: false,
		})

		const viewState = getMoonScanPermissionState([{ urn: 'urn:moons:view' }], false)
		expect(viewState).toMatchObject({
			canSubmit: true,
			canValidate: false,
			canView: true,
			canLeaderboard: true,
			canAccessMoonScan: true,
			canAdmin: false,
		})
	})

	it('treats moon admin as full access', () => {
		const state = getMoonScanPermissionState([{ urn: 'urn:moons:admin' }], false)
		expect(state).toMatchObject({
			canSubmit: true,
			canValidate: true,
			canView: true,
			canLeaderboard: true,
			canAccessMoonScan: true,
			canAdmin: true,
		})
	})
})
