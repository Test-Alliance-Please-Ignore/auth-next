import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import { waitUntilWithTelemetry } from '../../lib/background-task'
import { ActivityService } from '../../services/activity.service'
import { AuthService } from '../../services/auth.service'
import { hydrateCharacterAffiliation } from '../../services/character-affiliation-hydration.service'
import { reconcileUserCoreMembershipRoles } from '../../services/core-role-reconciliation.service'
import { autoRegisterDirectorCorporation } from '../../services/corporation-auto-register.service'
import { SessionService } from '../../services/session.service'
import { CharacterAlreadyClaimedError, UserService } from '../../services/user.service'
import authRoutes from '../auth'

import type { ClaimMainOAuthMetadata } from '../../db/schema'

vi.mock('../../db', () => ({ createDb: vi.fn() }))
vi.mock('@repo/do-utils', () => ({ getStub: vi.fn() }))
vi.mock('../../lib/background-task', () => ({ waitUntilWithTelemetry: vi.fn() }))
vi.mock('../../lib/ip-tracking', () => ({
	extractClientIp: vi.fn().mockReturnValue(null),
	recordUserIpAddress: vi.fn(),
}))
vi.mock('../../services/activity.service', () => ({ ActivityService: vi.fn() }))
vi.mock('../../services/auth.service', () => ({ AuthService: vi.fn() }))
vi.mock('../../services/session.service', () => ({ SessionService: vi.fn() }))
vi.mock('../../services/user.service', () => {
	// CharacterAlreadyClaimedError stays a real class: the route discriminates on it with
	// `instanceof`, so replacing it with a mock would make that branch untestable.
	class CharacterAlreadyClaimedError extends Error {}
	return { UserService: vi.fn(), CharacterAlreadyClaimedError }
})
vi.mock('../../services/character-affiliation-hydration.service', () => ({
	hydrateCharacterAffiliation: vi.fn(),
}))
vi.mock('../../services/core-role-reconciliation.service', () => ({
	reconcileUserCoreMembershipRoles: vi.fn(),
}))
vi.mock('../../services/corporation-auto-register.service', () => ({
	autoRegisterDirectorCorporation: vi.fn(),
}))
vi.mock('../../services/director-health-recheck.service', () => ({
	recheckDirectorHealthAfterTokenReauth: vi.fn(),
}))
vi.mock('../../services/mumble.service', () => ({ provisionTempopGuest: vi.fn() }))
vi.mock('../../services/mumble-tempop.service', () => ({ storeCredentialHandoff: vi.fn() }))
vi.mock('@repo/workflow-utils', () => ({ createWorkflow: vi.fn() }))

const createDbMock = vi.mocked(createDb)
const getStubMock = vi.mocked(getStub)

const FUTURE = new Date('2099-01-01T00:00:00.000Z')
const PAST = new Date('2000-01-01T00:00:00.000Z')

const env = {
	DATABASE_URL: 'postgres://test',
	EVE_TOKEN_STORE: { binding: 'tokens' },
	HR: { binding: 'hr' },
	EVE_CHARACTER_DATA: { binding: 'chardata' },
	EVE_CORPORATION_DATA: { binding: 'corpdata' },
	GROUPS: { binding: 'groups' },
	USER_REFRESH_WORKFLOW: { binding: 'wf' },
} as any

/**
 * Route handlers reach for c.executionCtx when scheduling background work. Mocking
 * waitUntilWithTelemetry is not enough: c.executionCtx is evaluated as an *argument* to it, so
 * it must exist or Hono throws before the mock is ever consulted.
 */
function execCtx() {
	return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any
}

function createApp() {
	const app = new Hono<{ Bindings: any; Variables: any }>()
	app.route('/api/auth', authRoutes)
	return app
}

/** A db mock whose oauth_states lookup returns `oauthState`, recording writes. */
function mockDb(oauthState: unknown) {
	const deleteWhere = vi.fn().mockResolvedValue(undefined)
	const updateWhere = vi.fn().mockResolvedValue(undefined)
	const insertValues = vi.fn().mockResolvedValue(undefined)

	createDbMock.mockReturnValue({
		query: {
			oauthStates: { findFirst: vi.fn().mockResolvedValue(oauthState) },
			users: { findFirst: vi.fn().mockResolvedValue(null) },
		},
		delete: vi.fn(() => ({ where: deleteWhere })),
		update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
		insert: vi.fn(() => ({ values: insertValues })),
	} as any)

	return { deleteWhere, updateWhere, insertValues }
}

const cleanHrStub = {
	isCharacterBlacklisted: vi.fn().mockResolvedValue(false),
	getBlacklistsForCharacter: vi.fn().mockResolvedValue([]),
	isCharacterNameBlacklisted: vi.fn().mockResolvedValue(false),
	getBlacklistsForCharacterName: vi.fn().mockResolvedValue([]),
	isUserBlacklisted: vi.fn().mockResolvedValue(false),
}

function mockStubs(tokenStore: Record<string, unknown>) {
	getStubMock.mockImplementation((binding: unknown) => {
		if (binding === env.EVE_TOKEN_STORE) return tokenStore as any
		if (binding === env.HR) return cleanHrStub as any
		return {} as any
	})
}

/**
 * Drive GET /auth/callback. `cookie` defaults to matching `state` (the honest browser); pass
 * it explicitly to model a browser that never started the flow.
 */
function callbackRequest(opts: { state?: string; cookie?: string } = {}) {
	const state = 'state' in opts ? opts.state : 'state-1'
	const cookie = 'cookie' in opts ? opts.cookie : state
	const query = state === undefined ? 'code=code-1' : `code=code-1&state=${state}`
	const headers: Record<string, string> = {}
	if (cookie !== undefined) headers.Cookie = `oauth_state=${cookie}`

	return createApp().request(`/api/auth/callback?${query}`, { headers }, env, execCtx())
}

function claimRequest(body: unknown) {
	return createApp().request(
		'/api/auth/claim-main',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		},
		env,
		execCtx()
	)
}

function loginState() {
	return {
		state: 'state-1',
		flowType: 'login',
		userId: null,
		redirectUrl: null,
		metadata: null,
		expiresAt: FUTURE,
	}
}

function claimTicketRow(overrides: Record<string, unknown> = {}) {
	return {
		state: 'ticket-1',
		flowType: 'claim-main',
		userId: null,
		redirectUrl: null,
		metadata: {
			characterId: 'char-1',
			characterName: 'Pilot',
			characterOwnerHash: 'HASH-1',
		} satisfies ClaimMainOAuthMetadata,
		expiresAt: FUTURE,
		...overrides,
	}
}

function tokenInfo(ownerHash: string) {
	return {
		characterId: 'char-1',
		characterName: 'Pilot',
		characterOwnerHash: ownerHash,
		scopes: [],
		isExpired: false,
		hasRefreshToken: true,
	}
}

function callbackResult(ownerHash: string) {
	return {
		success: true,
		characterId: 'char-1',
		characterInfo: {
			characterId: 'char-1',
			characterName: 'Pilot',
			characterOwnerHash: ownerHash,
			scopes: [],
		},
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(waitUntilWithTelemetry).mockImplementation(() => undefined)
	vi.mocked(ActivityService).mockImplementation(
		() =>
			({
				logLogin: vi.fn(),
				logLoginFailed: vi.fn(),
				logCharacterLinked: vi.fn(),
			}) as any
	)
	vi.mocked(SessionService).mockImplementation(
		() => ({ invalidateAllUserSessions: vi.fn().mockResolvedValue(1) }) as any
	)
	vi.mocked(AuthService).mockImplementation(
		() =>
			({
				createSession: vi.fn().mockResolvedValue({
					id: 'session-1',
					sessionToken: 'token-1',
					createdAt: new Date(),
				}),
			}) as any
	)
	vi.mocked(autoRegisterDirectorCorporation).mockResolvedValue(undefined as any)
	vi.mocked(reconcileUserCoreMembershipRoles).mockResolvedValue(undefined as any)
	vi.mocked(hydrateCharacterAffiliation).mockResolvedValue(undefined as any)
})

/**
 * Account pre-hijacking.
 *
 * Before: claim-main was unauthenticated AND took characterId from the request body, so any
 * unauthenticated caller could name a character that had completed SSO but not yet been
 * claimed and receive an account plus a 30-day session for it. The endpoint stays
 * unauthenticated by necessity (the caller has no account yet); the fix is that the *object*
 * it acts on now comes from a server-minted ticket rather than from the caller.
 */
describe('POST /api/auth/claim-main - authority comes from the ticket, not the body', () => {
	it('ignores a characterId supplied in the request body and uses the ticket-bound one', async () => {
		mockDb(
			claimTicketRow({
				metadata: {
					characterId: 'attacker-char',
					characterName: 'Attacker',
					characterOwnerHash: 'HASH-A',
				},
			})
		)

		// Returning null short-circuits the route; we only care which id it asked about.
		const getTokenInfo = vi.fn().mockResolvedValue(null)
		mockStubs({ getTokenInfo })

		// The victim's id is what the old code would have honoured.
		const res = await claimRequest({ claimTicket: 'ticket-1', characterId: 'victim-char' })

		expect(res.status).toBe(400)
		expect(getTokenInfo).toHaveBeenCalledWith('attacker-char')
		expect(getTokenInfo).not.toHaveBeenCalledWith('victim-char')
	})

	it('rejects a request with no ticket, without touching the token store', async () => {
		mockDb(null)
		const getTokenInfo = vi.fn()
		mockStubs({ getTokenInfo })

		const res = await claimRequest({ characterId: 'victim-char' })

		expect(res.status).toBe(400)
		expect(getTokenInfo).not.toHaveBeenCalled()
	})

	it('rejects an unknown ticket', async () => {
		mockDb(null)
		const getTokenInfo = vi.fn()
		mockStubs({ getTokenInfo })

		const res = await claimRequest({ claimTicket: 'no-such-ticket' })

		expect(res.status).toBe(400)
		expect(getTokenInfo).not.toHaveBeenCalled()
	})

	it('refuses to redeem a login state as a claim ticket, though both are oauth_states rows', async () => {
		// Metadata is deliberately claim-shaped so ONLY the flowType guard can reject this.
		mockDb(claimTicketRow({ state: 'login-state', flowType: 'login' }))
		const getTokenInfo = vi.fn()
		mockStubs({ getTokenInfo })

		const res = await claimRequest({ claimTicket: 'login-state' })

		expect(res.status).toBe(400)
		expect(getTokenInfo).not.toHaveBeenCalled()
	})

	it('rejects an expired ticket and deletes it', async () => {
		const { deleteWhere } = mockDb(claimTicketRow({ expiresAt: PAST }))
		const getTokenInfo = vi.fn()
		mockStubs({ getTokenInfo })

		const res = await claimRequest({ claimTicket: 'ticket-1' })

		expect(res.status).toBe(400)
		expect(getTokenInfo).not.toHaveBeenCalled()
		expect(deleteWhere).toHaveBeenCalled()
	})

	it('burns the ticket so it cannot be replayed', async () => {
		const { deleteWhere } = mockDb(claimTicketRow())
		mockStubs({ getTokenInfo: vi.fn().mockResolvedValue(null) })

		await claimRequest({ claimTicket: 'ticket-1' })

		expect(deleteWhere).toHaveBeenCalled()
	})

	it('refuses a ticket whose character changed hands before it was redeemed', async () => {
		mockDb(claimTicketRow())
		const createUser = vi.fn()
		// The token store reflects the CURRENT owner, who is not who the ticket was minted for.
		mockStubs({ getTokenInfo: vi.fn().mockResolvedValue(tokenInfo('HASH-2-NEW-OWNER')) })
		vi.mocked(UserService).mockImplementation(() => ({ createUser }) as any)

		const res = await claimRequest({ claimTicket: 'ticket-1' })

		expect(res.status).toBe(400)
		expect(createUser).not.toHaveBeenCalled()
	})

	it('answers 409 rather than 500 when the character was already claimed', async () => {
		mockDb(claimTicketRow())
		mockStubs({ getTokenInfo: vi.fn().mockResolvedValue(tokenInfo('HASH-1')) })
		vi.mocked(UserService).mockImplementation(
			() =>
				({
					createUser: vi
						.fn()
						.mockRejectedValue(new CharacterAlreadyClaimedError('User already exists')),
				}) as any
		)

		const res = await claimRequest({ claimTicket: 'ticket-1' })

		expect(res.status).toBe(409)
	})

	it('does not flatten an unexpected fault into a reassuring 409', async () => {
		mockDb(claimTicketRow())
		mockStubs({ getTokenInfo: vi.fn().mockResolvedValue(tokenInfo('HASH-1')) })
		vi.mocked(UserService).mockImplementation(
			() =>
				({
					// A database outage is not a lost race, and must stay loud.
					createUser: vi.fn().mockRejectedValue(new Error('connection terminated')),
				}) as any
		)

		const res = await claimRequest({ claimTicket: 'ticket-1' })

		expect(res.status).toBe(500)
	})
})

/**
 * Login CSRF. The oauth_states row proves only that *a* flow was started — /auth/login and
 * /auth/login/start are unauthenticated and hand a valid state to any caller — so the
 * browser-bound cookie is the half that actually does the work.
 */
describe('GET /api/auth/callback - the state must belong to this browser', () => {
	it('refuses an attacker-minted state replayed into a browser that never started a flow', async () => {
		// The row is perfectly valid: the attacker really did call /auth/login/start.
		mockDb(loginState())
		const handleCallback = vi.fn()
		mockStubs({ handleCallback })

		const res = await callbackRequest({ state: 'state-1', cookie: undefined })

		expect(res.status).toBe(400)
		// Never exchange an attacker's code in a victim's browser.
		expect(handleCallback).not.toHaveBeenCalled()
	})

	it('refuses when the cookie names a different flow than the query parameter', async () => {
		mockDb(loginState())
		const handleCallback = vi.fn()
		mockStubs({ handleCallback })

		const res = await callbackRequest({ state: 'state-1', cookie: 'a-different-state' })

		expect(res.status).toBe(400)
		expect(handleCallback).not.toHaveBeenCalled()
	})

	it('rejects a callback with no state at all, without exchanging the code', async () => {
		mockDb(loginState())
		const handleCallback = vi.fn()
		mockStubs({ handleCallback })

		const res = await callbackRequest({ state: undefined, cookie: undefined })

		expect(res.status).toBe(400)
		expect(handleCallback).not.toHaveBeenCalled()
	})

	it('rejects a state that was never issued', async () => {
		mockDb(null)
		const handleCallback = vi.fn()
		mockStubs({ handleCallback })

		const res = await callbackRequest({ state: 'forged-state' })

		expect(res.status).toBe(400)
		expect(handleCallback).not.toHaveBeenCalled()
	})

	it('rejects an expired state', async () => {
		mockDb({ ...loginState(), expiresAt: PAST })
		const handleCallback = vi.fn()
		mockStubs({ handleCallback })

		const res = await callbackRequest({ state: 'state-1' })

		expect(res.status).toBe(400)
		expect(handleCallback).not.toHaveBeenCalled()
	})

	it('refuses to redeem a claim-main ticket as a callback state', async () => {
		mockDb(claimTicketRow())
		const handleCallback = vi.fn()
		mockStubs({ handleCallback })

		const res = await callbackRequest({ state: 'ticket-1' })

		expect(res.status).toBe(400)
		expect(handleCallback).not.toHaveBeenCalled()
	})

	it('binds the state to the browser when a login flow starts', async () => {
		mockDb(null)
		mockStubs({
			startLoginFlow: vi.fn().mockResolvedValue({
				url: 'https://login.eveonline.com/authorize?state=state-xyz',
				state: 'state-xyz',
			}),
		})

		const res = await createApp().request(
			'/api/auth/login/start',
			{ method: 'POST' },
			env,
			execCtx()
		)

		expect(res.status).toBe(200)
		const cookie = res.headers.get('set-cookie')
		expect(cookie).toContain('oauth_state=state-xyz')
		expect(cookie).toContain('HttpOnly')
	})
})

/**
 * The mint half of the claim flow. Without these, the ticket could name any character at all
 * and every redeem-side test above would still pass.
 */
describe('GET /api/auth/callback - minting a claim ticket for a new user', () => {
	function mockNewUser() {
		mockStubs({ handleCallback: vi.fn().mockResolvedValue(callbackResult('HASH-1')) })
		vi.mocked(UserService).mockImplementation(
			() =>
				({
					// No account exists for this character yet.
					getUserByCharacterId: vi.fn().mockResolvedValue(null),
					getCharacterOwnership: vi.fn().mockResolvedValue(null),
				}) as any
		)
	}

	it('binds the ticket to the character SSO verified, not to anything client-supplied', async () => {
		const { insertValues } = mockDb(loginState())
		mockNewUser()

		const res = await callbackRequest({ state: 'state-1' })
		const body = (await res.json()) as { requiresClaimMain: boolean; claimTicket: string }

		expect(res.status).toBe(200)
		expect(body.requiresClaimMain).toBe(true)
		expect(body.claimTicket).toEqual(expect.any(String))

		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				state: body.claimTicket,
				flowType: 'claim-main',
				metadata: {
					characterId: 'char-1',
					characterName: 'Pilot',
					characterOwnerHash: 'HASH-1',
				},
			})
		)
	})

	it('gives the ticket a future expiry', async () => {
		const { insertValues } = mockDb(loginState())
		mockNewUser()

		await callbackRequest({ state: 'state-1' })

		const written = insertValues.mock.calls[0]?.[0] as { expiresAt: Date }
		expect(written.expiresAt.getTime()).toBeGreaterThan(Date.now())
	})
})

/**
 * Character transfer detection. CharacterOwnerHash rotates when a character changes hands; it
 * was written on every login and never compared, so a Bazaar sale handed the buyer the
 * seller's entire account.
 */
describe('GET /api/auth/callback - character owner hash is enforced on login', () => {
	it('refuses the login and kills existing sessions when the owner hash has rotated', async () => {
		mockDb(loginState())
		mockStubs({ handleCallback: vi.fn().mockResolvedValue(callbackResult('NEW-OWNER-HASH')) })

		const invalidateAllUserSessions = vi.fn().mockResolvedValue(1)
		vi.mocked(SessionService).mockImplementation(() => ({ invalidateAllUserSessions }) as any)

		const logLoginFailed = vi.fn()
		vi.mocked(ActivityService).mockImplementation(
			() => ({ logLogin: vi.fn(), logLoginFailed }) as any
		)

		vi.mocked(UserService).mockImplementation(
			() =>
				({
					getUserByCharacterId: vi.fn().mockResolvedValue({ id: 'seller-user', characters: [] }),
					getCharacterOwnership: vi.fn().mockResolvedValue({
						userId: 'seller-user',
						characterOwnerHash: 'OLD-OWNER-HASH',
					}),
				}) as any
		)

		const res = await callbackRequest({ state: 'state-1' })

		expect(res.status).toBe(403)
		// The seller must not keep a live session on an account the buyer now controls.
		expect(invalidateAllUserSessions).toHaveBeenCalledWith('seller-user')
		expect(logLoginFailed).toHaveBeenCalled()
		// Above all: no session may be minted for the new owner.
		expect(res.headers.get('set-cookie')).not.toContain('session=')
	})

	it('allows the login when the owner hash still matches', async () => {
		mockDb(loginState())
		mockStubs({ handleCallback: vi.fn().mockResolvedValue(callbackResult('SAME-HASH')) })

		vi.mocked(UserService).mockImplementation(
			() =>
				({
					getUserByCharacterId: vi.fn().mockResolvedValue({ id: 'user-1', characters: [] }),
					getCharacterOwnership: vi.fn().mockResolvedValue({
						userId: 'user-1',
						characterOwnerHash: 'SAME-HASH',
					}),
				}) as any
		)

		const res = await callbackRequest({ state: 'state-1' })

		expect(res.status).toBe(200)
		expect(res.headers.get('set-cookie')).toContain('session=')
	})

	it('marks an already-linked character token valid when it is reauthorized', async () => {
		const { updateWhere } = mockDb({
			state: 'state-1',
			flowType: 'character',
			userId: 'user-1',
			redirectUrl: null,
			metadata: null,
			expiresAt: FUTURE,
		})
		mockStubs({ handleCallback: vi.fn().mockResolvedValue(callbackResult('SAME-HASH')) })

		vi.mocked(UserService).mockImplementation(
			() =>
				({
					getUserById: vi.fn().mockResolvedValue({
						id: 'user-1',
						characters: [
							{
								characterId: 'char-1',
								characterName: 'Pilot',
								hasValidToken: false,
							},
						],
					}),
					getUserByCharacterId: vi.fn().mockResolvedValue({
						id: 'user-1',
						characters: [
							{
								characterId: 'char-1',
								characterName: 'Pilot',
								hasValidToken: false,
							},
						],
					}),
					getCharacterOwnership: vi.fn().mockResolvedValue({
						userId: 'user-1',
						characterOwnerHash: 'SAME-HASH',
					}),
				}) as any
		)

		const res = await callbackRequest({ state: 'state-1' })

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({
			characterLinked: true,
			tokenUpdated: true,
			character: {
				characterId: 'char-1',
				characterName: 'Pilot',
				hasValidToken: true,
			},
		})
		expect(updateWhere).toHaveBeenCalled()
	})

	it('adopts the real hash for a legacy-imported character instead of locking the user out', async () => {
		// Legacy imports store a placeholder, never a CCP hash. Comparing it would refuse every
		// migrated user on sight and wipe their sessions, with no self-service path back.
		mockDb(loginState())
		mockStubs({ handleCallback: vi.fn().mockResolvedValue(callbackResult('REAL-CCP-HASH')) })

		const adoptCharacterOwnerHash = vi.fn().mockResolvedValue(undefined)
		const invalidateAllUserSessions = vi.fn()
		vi.mocked(SessionService).mockImplementation(() => ({ invalidateAllUserSessions }) as any)

		vi.mocked(UserService).mockImplementation(
			() =>
				({
					getUserByCharacterId: vi.fn().mockResolvedValue({ id: 'migrated-user', characters: [] }),
					getCharacterOwnership: vi.fn().mockResolvedValue({
						userId: 'migrated-user',
						characterOwnerHash: 'legacy-import:42:esi_owner',
					}),
					adoptCharacterOwnerHash,
				}) as any
		)

		const res = await callbackRequest({ state: 'state-1' })

		expect(res.status).toBe(200)
		expect(res.headers.get('set-cookie')).toContain('session=')
		expect(adoptCharacterOwnerHash).toHaveBeenCalledWith('char-1', 'REAL-CCP-HASH')
		expect(invalidateAllUserSessions).not.toHaveBeenCalled()
	})
})

describe('POST /api/auth/link-character - removed', () => {
	it('no longer exists, so a body-supplied characterId cannot absorb a character', async () => {
		mockDb(null)
		mockStubs({ getTokenInfo: vi.fn() })

		const res = await createApp().request(
			'/api/auth/link-character',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ characterId: 'victim-char' }),
			},
			env,
			execCtx()
		)

		expect(res.status).toBe(404)
	})
})
