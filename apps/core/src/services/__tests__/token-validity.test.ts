import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
	resolveNextTokenValidity,
	validateAndSyncCharacterTokenValidity,
	validateAndSyncCharacterTokenValidityBatch,
} from '../../lib/token-validity'

function makeValidationResult(overrides: Record<string, unknown> = {}) {
	return {
		characterId: '2001',
		isValid: true,
		missingScopes: [],
		refreshAttempted: false,
		refreshSucceeded: false,
		scopes: ['publicData'],
		status: 'valid',
		...overrides,
	}
}

function makeDbRecorder(existingHasValidToken: boolean | null = null) {
	const updates: unknown[] = []
	const where = vi.fn().mockResolvedValue(undefined)
	const set = vi.fn((payload: unknown) => {
		updates.push(payload)
		return { where }
	})
	const update = vi.fn(() => ({ set }))
	const findFirst = vi.fn().mockResolvedValue({
		hasValidToken: existingHasValidToken,
	})

	return {
		db: {
			query: {
				userCharacters: {
					findFirst,
				},
			},
			update,
		},
		findFirst,
		update,
		set,
		updates,
		where,
	}
}

describe('token-validity helper', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('preserves previous validity on transient_error', () => {
		expect(
			resolveNextTokenValidity(
				true,
				makeValidationResult({
					isValid: false,
					status: 'transient_error',
					error: 'Upstream unavailable',
				}) as any
			)
		).toBe(true)
	})

	it('writes updated hasValidToken from live validation', async () => {
		const recorder = makeDbRecorder(false)
		const tokenStore = {
			validateToken: vi.fn().mockResolvedValue(makeValidationResult({ isValid: true })),
		}

		const result = await validateAndSyncCharacterTokenValidity({
			db: recorder.db as any,
			tokenStore: tokenStore as any,
			characterId: '2001',
		})

		expect(result.previousHasValidToken).toBe(false)
		expect(result.nextHasValidToken).toBe(true)
		expect(recorder.updates[0]).toMatchObject({
			hasValidToken: true,
		})
	})

	it('does not write when transient_error keeps prior state and no refresh touch requested', async () => {
		const recorder = makeDbRecorder(true)
		const tokenStore = {
			validateToken: vi.fn().mockResolvedValue(
				makeValidationResult({
					isValid: false,
					status: 'transient_error',
				})
			),
		}

		const result = await validateAndSyncCharacterTokenValidity({
			db: recorder.db as any,
			tokenStore: tokenStore as any,
			characterId: '2001',
			previousHasValidToken: true,
		})

		expect(result.nextHasValidToken).toBe(true)
		expect(recorder.update).not.toHaveBeenCalled()
	})

	it('writes even when state unchanged if touchLastCharacterRefresh is requested', async () => {
		const recorder = makeDbRecorder(true)
		const tokenStore = {
			validateToken: vi.fn().mockResolvedValue(
				makeValidationResult({
					isValid: false,
					status: 'transient_error',
				})
			),
		}

		await validateAndSyncCharacterTokenValidity({
			db: recorder.db as any,
			tokenStore: tokenStore as any,
			characterId: '2001',
			previousHasValidToken: true,
			touchLastCharacterRefresh: true,
		})

		expect(recorder.updates[0]).toMatchObject({
			hasValidToken: true,
		})
		expect(recorder.updates[0]).toHaveProperty('lastCharacterRefresh')
	})

	it('batch helper falls back to prior state for validation failures', async () => {
		const recorder = makeDbRecorder(null)
		const tokenStore = {
			validateToken: vi
				.fn()
				.mockResolvedValueOnce(makeValidationResult({ characterId: '2001', isValid: true }))
				.mockRejectedValueOnce(new Error('token store unavailable')),
		}

		const results = await validateAndSyncCharacterTokenValidityBatch({
			db: recorder.db as any,
			tokenStore: tokenStore as any,
			characters: [
				{ characterId: '2001', hasValidToken: false },
				{ characterId: '2002', hasValidToken: true },
			],
			maxConcurrency: 2,
		})

		expect(results.get('2001')).toBe(true)
		expect(results.get('2002')).toBe(true)
	})
})

