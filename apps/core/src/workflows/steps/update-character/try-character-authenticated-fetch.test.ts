import { beforeEach, describe, expect, it, vi } from 'vitest'

import { tryCharacterAuthenticatedFetch } from './try-character-authenticated-fetch'

import type { WorkflowContext } from '../../context'

const validateToken = vi.fn()

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(() => ({
		validateToken,
	})),
}))

function createDbRecorder(existingHasValidToken: boolean | null = null) {
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

function createCtx(db: WorkflowContext['db']): WorkflowContext {
	return {
		db,
		env: {
			ESI: {} as DurableObjectNamespace,
			ESI_TYPE_RESOLVER: {} as DurableObjectNamespace,
			EVE_TOKEN_STORE: {} as DurableObjectNamespace,
		} as WorkflowContext['env'],
		refreshMode: 'manual',
		userId: 'user-1',
		workflowInstanceId: 'workflow-1',
	}
}

describe('tryCharacterAuthenticatedFetch', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('marks the character token valid when verification succeeds', async () => {
		validateToken.mockResolvedValue({
			characterId: '123',
			isValid: true,
			missingScopes: [],
			refreshAttempted: false,
			refreshSucceeded: false,
			scopes: ['esi-location.read_location.v1'],
			status: 'valid',
		})
		const recorder = createDbRecorder(false)

		const result = await tryCharacterAuthenticatedFetch(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'123'
		)

		expect(result.success).toBe(true)
		expect(result.status).toBe('valid')
		expect(recorder.updates[0]).toMatchObject({
			hasValidToken: true,
		})
	})

	it('marks the character token invalid when required scopes are missing', async () => {
		validateToken.mockResolvedValue({
			characterId: '123',
			error: 'Missing required scopes: esi-location.read_location.v1',
			isValid: false,
			missingScopes: ['esi-location.read_location.v1'],
			refreshAttempted: false,
			refreshSucceeded: false,
			scopes: ['publicData'],
			status: 'missing_scopes',
		})
		const recorder = createDbRecorder(true)

		const result = await tryCharacterAuthenticatedFetch(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'123'
		)

		expect(result.success).toBe(false)
		expect(result.status).toBe('missing_scopes')
		expect(recorder.updates[0]).toMatchObject({
			hasValidToken: false,
		})
	})

	it('preserves the prior token validity on transient verification failures', async () => {
		validateToken.mockResolvedValue({
			characterId: '123',
			error: 'Token verification failed (status: 503): upstream unavailable',
			isValid: false,
			missingScopes: [],
			refreshAttempted: false,
			refreshSucceeded: false,
			scopes: ['esi-location.read_location.v1'],
			status: 'transient_error',
		})
		const recorder = createDbRecorder(true)

		const result = await tryCharacterAuthenticatedFetch(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'123'
		)

		expect(result.success).toBe(false)
		expect(result.status).toBe('transient_error')
		expect(recorder.updates[0]).toMatchObject({
			hasValidToken: true,
		})
	})
})
