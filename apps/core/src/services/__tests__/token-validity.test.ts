import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
	isAuthenticatedEsiTokenFailure,
	markCharacterTokenInvalidFromAuthFailure,
	resolveNextTokenValidity,
	validateAndSyncCharacterTokenValidity,
	validateAndSyncCharacterTokenValidityBatch,
	validateAndSyncCharacterTokenValidityBatchTransitions,
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
	const findMany = vi.fn().mockResolvedValue([])

	return {
		db: {
			query: {
				userCharacters: {
					findFirst,
					findMany,
				},
			},
			update,
		},
		findFirst,
		findMany,
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

	it('degrades validity on permanent_invalid', () => {
		expect(
			resolveNextTokenValidity(
				true,
				makeValidationResult({
					isValid: false,
					status: 'permanent_invalid',
					error: 'refresh token permanently invalid',
				}) as any
			)
		).toBe(false)
	})

	it('classifies authenticated ESI 401 failures as token failures', () => {
		expect(
			isAuthenticatedEsiTokenFailure(
				new Error(
					'ESI request failed: 401 Unauthorized - {"error":"Unauthorized"} | metadata={"status":401,"path":"/characters/123/wallet"}'
				)
			)
		).toBe(true)
	})

	it('marks character token invalid from authenticated ESI auth failures', async () => {
		const recorder = makeDbRecorder(true)

		const marked = await markCharacterTokenInvalidFromAuthFailure({
			db: recorder.db as any,
			characterId: '2001',
			error: new Error(
				'ESI request failed: 401 Unauthorized - {"error":"Unauthorized"} | metadata={"status":401,"path":"/characters/123/wallet"}'
			),
			touchLastCharacterRefresh: true,
		})

		expect(marked).toBe(true)
		expect(recorder.updates[0]).toMatchObject({
			hasValidToken: false,
		})
		expect(recorder.updates[0]).toHaveProperty('lastCharacterRefresh')
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
		recorder.findMany.mockResolvedValue([
			{
				characterId: '2001',
				hasValidToken: false,
				lastCharacterRefresh: new Date(Date.now() - 25 * 60 * 60 * 1000),
			},
			{
				characterId: '2002',
				hasValidToken: true,
				lastCharacterRefresh: new Date(Date.now() - 25 * 60 * 60 * 1000),
			},
		])
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

	it('batch helper reuses fresh cached token validity without live validation', async () => {
		const recorder = makeDbRecorder(null)
		recorder.findMany.mockResolvedValue([
			{
				characterId: '2001',
				hasValidToken: true,
				lastCharacterRefresh: new Date(Date.now() - 60 * 60 * 1000),
			},
		])
		const tokenStore = {
			validateToken: vi.fn(),
		}

		const results = await validateAndSyncCharacterTokenValidityBatch({
			db: recorder.db as any,
			tokenStore: tokenStore as any,
			characters: [{ characterId: '2001', hasValidToken: false }],
		})

		expect(results.get('2001')).toBe(true)
		expect(tokenStore.validateToken).not.toHaveBeenCalled()
		expect(recorder.update).not.toHaveBeenCalled()
	})

	it('batch helper validates stale entries and touches refresh timestamp', async () => {
		const recorder = makeDbRecorder(null)
		recorder.findMany.mockResolvedValue([
			{
				characterId: '2001',
				hasValidToken: true,
				lastCharacterRefresh: new Date(Date.now() - 25 * 60 * 60 * 1000),
			},
		])
		const tokenStore = {
			validateToken: vi.fn().mockResolvedValue(makeValidationResult({ characterId: '2001', isValid: false })),
		}

		const results = await validateAndSyncCharacterTokenValidityBatch({
			db: recorder.db as any,
			tokenStore: tokenStore as any,
			characters: [{ characterId: '2001' }],
		})

		expect(results.get('2001')).toBe(false)
		expect(tokenStore.validateToken).toHaveBeenCalledWith('2001', undefined, { force: false })
		expect(recorder.updates[0]).toHaveProperty('lastCharacterRefresh')
	})

	it('batch transition helper preserves input order and reports cached rows without validation', async () => {
		const recorder = makeDbRecorder(null)
		recorder.findMany.mockResolvedValue([
			{
				characterId: '2001',
				hasValidToken: true,
				lastCharacterRefresh: new Date(Date.now() - 25 * 60 * 60 * 1000),
			},
			{
				characterId: '2002',
				hasValidToken: false,
				lastCharacterRefresh: new Date(Date.now() - 60 * 60 * 1000),
			},
		])
		const tokenStore = {
			validateToken: vi.fn().mockResolvedValue(
				makeValidationResult({
					characterId: '2001',
					isValid: false,
					status: 'invalid_token',
				})
			),
		}

		const transitions = await validateAndSyncCharacterTokenValidityBatchTransitions({
			db: recorder.db as any,
			tokenStore: tokenStore as any,
			characters: [
				{ characterId: '2001', hasValidToken: true },
				{ characterId: '2002', hasValidToken: false },
			],
			maxConcurrency: 1,
		})

		expect(transitions).toHaveLength(2)
		expect(transitions[0]).toMatchObject({
			characterId: '2001',
			previousHasValidToken: true,
			nextHasValidToken: false,
			validationError: null,
		})
		expect(transitions[1]).toMatchObject({
			characterId: '2002',
			previousHasValidToken: false,
			nextHasValidToken: false,
			validation: null,
			validationError: null,
		})
		expect(tokenStore.validateToken).toHaveBeenCalledTimes(1)
		expect(tokenStore.validateToken).toHaveBeenCalledWith('2001', undefined, { force: false })
	})
})
