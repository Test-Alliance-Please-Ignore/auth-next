import { describe, expect, it } from 'vitest'

import { calculateGlobalCacheTtlSeconds } from './cache'

describe('calculateGlobalCacheTtlSeconds', () => {
	const nowMs = Date.parse('2026-09-28T20:00:00.000Z')

	it('clamps short future expirations to Cloudflare KV minimum TTL', () => {
		expect(calculateGlobalCacheTtlSeconds(new Date(nowMs + 19_000), nowMs)).toBe(60)
	})

	it('preserves normal TTLs and skips expired entries', () => {
		expect(calculateGlobalCacheTtlSeconds(new Date(nowMs + 120_000), nowMs)).toBe(120)
		expect(calculateGlobalCacheTtlSeconds(new Date(nowMs - 1), nowMs)).toBeNull()
	})
})
