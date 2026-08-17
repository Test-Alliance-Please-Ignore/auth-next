import { beforeEach, describe, expect, it, vi } from 'vitest'

import { tryCharacterAuthenticatedFetch } from './try-character-authenticated-fetch'

import type { WorkflowContext } from '../../context'

const validateToken = vi.fn()
const fetchAuthenticatedData = vi.fn().mockResolvedValue(undefined)
const fetchWalletJournal = vi.fn().mockResolvedValue(undefined)
const queueTokenInvalidationAlerts = vi.fn().mockResolvedValue({
	added: 1,
	skipped: 0,
	pendingCount: 1,
})

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(() => ({
		validateToken,
		fetchAuthenticatedData,
		fetchWalletJournal,
		queueTokenInvalidationAlerts,
	})),
}))

function createDbRecorder(
	existingHasValidToken: boolean | null = null,
	corporationId: string | null = null,
	memberCorporation: { corporationId: string } | null = null
) {
	const updates: unknown[] = []
	const where = vi.fn().mockResolvedValue(undefined)
	const set = vi.fn((payload: unknown) => {
		updates.push(payload)
		return { where }
	})
	const update = vi.fn(() => ({ set }))
	const findFirst = vi.fn().mockResolvedValue({
		hasValidToken: existingHasValidToken,
		corporationId,
	})
	const findMemberCorporation = vi.fn().mockResolvedValue(memberCorporation)

	return {
		db: {
			query: {
				userCharacters: {
					findFirst,
				},
				managedCorporations: {
					findFirst: findMemberCorporation,
				},
			},
			update,
		},
		findFirst,
		update,
		set,
		updates,
		where,
		findMemberCorporation,
	}
}

function createCtx(db: WorkflowContext['db']): WorkflowContext {
	return {
		db,
		env: {
			CORE: {} as DurableObjectNamespace,
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
		fetchAuthenticatedData.mockResolvedValue(undefined)
		fetchWalletJournal.mockResolvedValue(undefined)
		queueTokenInvalidationAlerts.mockResolvedValue({
			added: 1,
			skipped: 0,
			pendingCount: 1,
		})
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
		expect(result.tokenInvalidated).toBe(false)
		expect(recorder.updates[0]).toMatchObject({
			hasValidToken: true,
		})
		expect(queueTokenInvalidationAlerts).not.toHaveBeenCalled()
	})

	it('refreshes the wallet journal for an admin sync in a member corporation', async () => {
		validateToken.mockResolvedValue({
			characterId: '123',
			isValid: true,
			missingScopes: [],
			refreshAttempted: false,
			refreshSucceeded: false,
			scopes: ['esi-wallet.read_character_wallet.v1'],
			status: 'valid',
		})
		const recorder = createDbRecorder(false, '987654321', { corporationId: '987654321' })
		const context = createCtx(recorder.db as unknown as WorkflowContext['db'])
		context.includeWalletJournal = true

		const result = await tryCharacterAuthenticatedFetch(context, '123')

		expect(result.success).toBe(true)
		expect(fetchWalletJournal).toHaveBeenCalledWith('123', true)
		expect(recorder.findMemberCorporation).toHaveBeenCalled()
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
		expect(result.tokenInvalidated).toBe(true)
		expect(recorder.updates[0]).toMatchObject({
			hasValidToken: false,
		})
		expect(queueTokenInvalidationAlerts).toHaveBeenCalledWith({
			userId: 'user-1',
			characterIds: ['123'],
			source: 'character-refresh-token-invalidated',
		})
	})

	it('does not queue invalidation alerts when the token was already invalid', async () => {
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
		const recorder = createDbRecorder(false)

		const result = await tryCharacterAuthenticatedFetch(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'123'
		)

		expect(result.success).toBe(false)
		expect(result.status).toBe('missing_scopes')
		expect(result.tokenInvalidated).toBe(false)
		expect(queueTokenInvalidationAlerts).not.toHaveBeenCalled()
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
		expect(result.tokenInvalidated).toBe(false)
		expect(recorder.updates[0]).toMatchObject({
			hasValidToken: true,
		})
		expect(queueTokenInvalidationAlerts).not.toHaveBeenCalled()
	})

	it('marks the character token invalid when authenticated ESI fetch returns 401', async () => {
		validateToken.mockResolvedValue({
			characterId: '123',
			isValid: true,
			missingScopes: [],
			refreshAttempted: false,
			refreshSucceeded: false,
			scopes: ['esi-location.read_location.v1'],
			status: 'valid',
		})
		fetchAuthenticatedData.mockRejectedValue(
			new Error(
				'ESI request failed: 401 Unauthorized - {"error":"Unauthorized"} | metadata={"status":401,"path":"/characters/123/wallet"}'
			)
		)
		const recorder = createDbRecorder(true)

		const result = await tryCharacterAuthenticatedFetch(
			createCtx(recorder.db as unknown as WorkflowContext['db']),
			'123'
		)

		expect(result.success).toBe(false)
		expect(result.status).toBe('invalid_token')
		expect(result.tokenInvalidated).toBe(true)
		expect(recorder.updates.at(-1)).toMatchObject({
			hasValidToken: false,
		})
		expect(queueTokenInvalidationAlerts).toHaveBeenCalledWith({
			userId: 'user-1',
			characterIds: ['123'],
			source: 'character-refresh-token-invalidated',
		})
	})
})
