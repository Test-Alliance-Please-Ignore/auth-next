import { describe, expect, it } from 'vitest'

import {
	hasMaintenanceSecret,
	isLegacyCachePurgeConfirmed,
	LEGACY_CACHE_PURGE_CONFIRMATION,
} from '../../lib/legacy-storage-maintenance'

describe('legacy token-store maintenance controls', () => {
	it('requires the exact purge confirmation', () => {
		expect(isLegacyCachePurgeConfirmed(LEGACY_CACHE_PURGE_CONFIRMATION)).toBe(true)
		expect(isLegacyCachePurgeConfirmed('PURGE_ALL')).toBe(false)
		expect(isLegacyCachePurgeConfirmed(undefined)).toBe(false)
	})

	it('requires a configured secret and compares it without early exit', () => {
		expect(hasMaintenanceSecret(undefined, 'secret')).toBe(false)
		expect(hasMaintenanceSecret('secret', undefined)).toBe(false)
		expect(hasMaintenanceSecret('secret', 'secret')).toBe(true)
		expect(hasMaintenanceSecret('secret', 'secreT')).toBe(false)
		expect(hasMaintenanceSecret('secret', 'secret-too-long')).toBe(false)
	})
})
