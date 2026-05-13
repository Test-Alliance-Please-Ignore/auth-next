import { describe, expect, it } from 'vitest'

import {
	chunkRows,
	isLikelyIp,
	mapLegacyEventCode,
	toDateOrNull,
} from './import-legacy-snapshot.helpers'

describe('import-legacy-snapshot helpers', () => {
	it('maps legacy event codes', () => {
		expect(mapLegacyEventCode(0)).toBe('status_change')
		expect(mapLegacyEventCode(1)).toBe('staff_note')
		expect(mapLegacyEventCode(2)).toBe('rejection_reason')
		expect(mapLegacyEventCode(3)).toBe('accepted')
		expect(mapLegacyEventCode(4)).toBe('message')
		expect(mapLegacyEventCode(999)).toBe('unknown')
	})

	it('detects likely ip strings', () => {
		expect(isLikelyIp('1.2.3.4')).toBe(true)
		expect(isLikelyIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true)
		expect(isLikelyIp('not-an-ip')).toBe(false)
		expect(isLikelyIp('')).toBe(false)
	})

	it('parses dates safely', () => {
		const now = new Date()
		expect(toDateOrNull(now)).toBe(now)
		expect(toDateOrNull('2026-01-01T00:00:00.000Z')).toBeInstanceOf(Date)
		expect(toDateOrNull('2026-01-01 00:00:00')?.toISOString()).toBe('2026-01-01T00:00:00.000Z')
		expect(toDateOrNull('invalid-date')).toBeNull()
		expect(toDateOrNull(null)).toBeNull()
	})

	it('chunks rows by requested size', () => {
		expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
		expect(chunkRows<number>([], 10)).toEqual([])
	})
})
