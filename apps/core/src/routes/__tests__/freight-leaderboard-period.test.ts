import { describe, expect, it } from 'vitest'

import { resolveFreightLeaderboardWindow } from '../freight-leaderboard-period'

describe('resolveFreightLeaderboardWindow', () => {
	it('defaults to all time when no period is provided', () => {
		const window = resolveFreightLeaderboardWindow(undefined, new Date('2026-07-17T12:34:56Z'))

		expect(window.since).toBeUndefined()
		expect(window.before).toBeUndefined()
	})

	it('maps the 30d alias to the current month', () => {
		const window = resolveFreightLeaderboardWindow('30d', new Date('2026-07-17T12:34:56Z'))

		expect(window.since?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
		expect(window.before).toBeUndefined()
	})

	it('returns a bounded range for the previous month', () => {
		const window = resolveFreightLeaderboardWindow('previous-month', new Date('2026-07-17T12:34:56Z'))

		expect(window.since?.toISOString()).toBe('2026-06-01T00:00:00.000Z')
		expect(window.before?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
	})

	it('returns no bounds for all time', () => {
		const window = resolveFreightLeaderboardWindow('all', new Date('2026-07-17T12:34:56Z'))

		expect(window.since).toBeUndefined()
		expect(window.before).toBeUndefined()
	})
})
