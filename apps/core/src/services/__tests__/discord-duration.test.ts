import { describe, expect, it } from 'vitest'

import { parseDiscordDurationSeconds } from '../discord-duration'

describe('parseDiscordDurationSeconds', () => {
	it('parses common natural language forms and compounds', () => {
		expect(parseDiscordDurationSeconds('1 hour')).toBe(60 * 60)
		expect(parseDiscordDurationSeconds('1hr')).toBe(60 * 60)
		expect(parseDiscordDurationSeconds('1.5 hours')).toBe(90 * 60)
		expect(parseDiscordDurationSeconds('1 hour 1 minute')).toBe(3660)
		expect(parseDiscordDurationSeconds('10 days')).toBe(10 * 86400)
		expect(parseDiscordDurationSeconds('3 days 12 hours')).toBe(3 * 86400 + 12 * 3600)
		expect(parseDiscordDurationSeconds('9 months & 2 days')).toBe(9 * 30 * 86400 + 2 * 86400)
		expect(parseDiscordDurationSeconds('3 months and 2 weeks')).toBe(3 * 30 * 86400 + 2 * 7 * 86400)
		expect(parseDiscordDurationSeconds('1.5 months')).toBe(45 * 86400)
	})

	it('supports non-expiring values', () => {
		expect(parseDiscordDurationSeconds('forever')).toBeNull()
		expect(parseDiscordDurationSeconds(' permanent ')).toBeNull()
	})

	it('rejects zero, invalid text, and values over one year', () => {
		expect(() => parseDiscordDurationSeconds('0 hours')).toThrow()
		expect(() => parseDiscordDurationSeconds('30 seconds')).toThrow()
		expect(() => parseDiscordDurationSeconds('-1 hour')).toThrow()
		expect(() => parseDiscordDurationSeconds('tomorrow')).toThrow()
		expect(() => parseDiscordDurationSeconds('2 years')).toThrow()
	})
})
