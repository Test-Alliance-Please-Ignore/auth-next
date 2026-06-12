import { describe, expect, it, vi } from 'vitest'

import { deriveLoginName } from '../mumble.service'

// @neondatabase/api-client (pulled in via @repo/db-utils test helpers) breaks
// the workers-pool CJS shim; it is irrelevant to these tests.
vi.mock('@neondatabase/api-client', () => ({
	createApiClient: vi.fn(),
	EndpointType: {},
}))

const USER_ID = '123e4567-e89b-12d3-a456-426614174000'

describe('deriveLoginName', () => {
	it('replaces spaces with underscores', () => {
		expect(deriveLoginName('Pilot One', USER_ID)).toBe('Pilot_One')
	})

	it('keeps allowed characters and strips the rest', () => {
		expect(deriveLoginName("Kael'Thar D-Ray.99", USER_ID)).toBe('KaelThar_D-Ray.99')
	})

	it('collapses repeated underscores', () => {
		expect(deriveLoginName('A   B', USER_ID)).toBe('A_B')
	})

	it('trims leading/trailing separators left by stripping', () => {
		expect(deriveLoginName("'Quote' Name", USER_ID)).toBe('Quote_Name')
	})

	it('caps the length at 60 characters', () => {
		const long = 'x'.repeat(100)
		expect(deriveLoginName(long, USER_ID)).toHaveLength(60)
	})

	it('falls back to a userId-derived name when nothing usable remains', () => {
		expect(deriveLoginName('日本語の名前', USER_ID)).toBe('user_123e4567')
		expect(deriveLoginName('', USER_ID)).toBe('user_123e4567')
		expect(deriveLoginName("'''", USER_ID)).toBe('user_123e4567')
	})
})
