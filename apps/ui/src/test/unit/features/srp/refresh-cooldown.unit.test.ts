import { describe, expect, it } from 'vitest'

import {
	persistRefreshCooldownUntilMs,
	readRefreshCooldownUntilMs,
	REFRESH_COOLDOWN_STORAGE_KEY,
} from '@/features/srp/state/refresh-cooldown'

function createMemoryStorage() {
	const map = new Map<string, string>()
	return {
		getItem(key: string) {
			return map.has(key) ? map.get(key)! : null
		},
		setItem(key: string, value: string) {
			map.set(key, value)
		},
		removeItem(key: string) {
			map.delete(key)
		},
	}
}

describe('srp refresh cooldown persistence', () => {
	it('reads valid persisted cooldown timestamp', () => {
		const storage = createMemoryStorage()
		storage.setItem(REFRESH_COOLDOWN_STORAGE_KEY, '123456')
		expect(readRefreshCooldownUntilMs(storage)).toBe(123456)
	})

	it('clears expired cooldown entries', () => {
		const storage = createMemoryStorage()
		storage.setItem(REFRESH_COOLDOWN_STORAGE_KEY, '1000')
		persistRefreshCooldownUntilMs(storage, 1000, 1001)
		expect(storage.getItem(REFRESH_COOLDOWN_STORAGE_KEY)).toBeNull()
	})

	it('persists active cooldown entries', () => {
		const storage = createMemoryStorage()
		persistRefreshCooldownUntilMs(storage, 5000, 1000)
		expect(storage.getItem(REFRESH_COOLDOWN_STORAGE_KEY)).toBe('5000')
	})
})
