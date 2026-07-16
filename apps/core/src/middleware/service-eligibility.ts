import { isUserEligibleForServices } from '../lib/service-eligibility'

import type { MiddlewareHandler } from 'hono'
import type { App } from '../context'

/**
 * Response code returned to the client on a 403 from this guard. The UI switches
 * on it to hide the affordance rather than let someone click a button that can
 * only fail.
 */
export const NOT_MEMBER_CORP_CODE = 'not_member_corp'

/**
 * Gate a SELF-SERVICE GRANT path on the services eligibility rule: the user must
 * have a character in a member corporation, or be a site admin.
 *
 * ── WHY THIS EXISTS ──
 *
 * Eligibility is DERIVED state, not stored state — it is recomputed from
 * `managed_corporations.is_member_corporation` on every read. So revoking access
 * is not a one-shot act. Without the same predicate on the grant paths, a user
 * whose access is revoked simply grants it back to themselves and the revocation
 * was theatre. `POST /api/discord/join-servers` re-invites and re-grants roles on
 * demand today, behind nothing but `requireAuth()`.
 *
 * ── WHERE TO PUT IT ──
 *
 * On ROUTES, never inside the service functions. Two of those services are called
 * by enforcement itself: `enforceBlacklistedMumbleAccess` calls
 * `resetMumblePassword` to rotate a blacklisted user's password AS the lockout,
 * and a blacklisted user is also ineligible — a gate inside the service would
 * throw there, be swallowed by that call's `.catch()`, and quietly leave the
 * blacklisted user's credentials working. `syncUserDiscordAccess` is likewise
 * shared with the refresh workflow, the admin route and two RPC surfaces, none of
 * which are self-service.
 *
 * Gate only the GRANT paths. Reads (e.g. GET /api/mumble/account) stay open — an
 * ineligible user should still be able to see the state of their own account.
 *
 * ── WHAT THIS DOES NOT DO ──
 *
 * It does not revoke anything, and it does not stop a background sync from
 * re-granting roles on a membership event. That convergence problem is a separate
 * change to the expected-role-set computation.
 */
export const requireServiceEligibility = (): MiddlewareHandler<App> => {
	return async (c, next) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const db = c.get('db')
		if (!db) {
			// Fail CLOSED. This guard protects a grant path, so an unavailable
			// database must not become an open door.
			return c.json({ error: 'Database not available' }, 500)
		}

		if (!(await isUserEligibleForServices(db, user.id))) {
			return c.json(
				{
					error:
						'Services access requires a character in a member corporation. If you have recently joined one, your character data may not have synced yet.',
					code: NOT_MEMBER_CORP_CODE,
				},
				403
			)
		}

		return next()
	}
}
