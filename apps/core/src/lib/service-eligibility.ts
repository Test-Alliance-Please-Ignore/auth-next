import { and, eq, sql } from '@repo/db-utils'

import { managedCorporations, userCharacters, users } from '../db/schema'

import type { DbClient, schema } from '../db'
import type { SERVICE_ELIGIBILITY_REASONS } from '../db/schema'

/**
 * THE SERVICES ELIGIBILITY RULE — stated once, here.
 *
 *   A user is ELIGIBLE for services iff they have at least one non-deleted
 *   character whose corporation is flagged `is_member_corporation = true`,
 *   OR they are a site admin.
 *
 * This mirrors the rule Mumble already enforces today (see `getUserGroupNames`
 * in services/mumble.service.ts): a user with no member-corporation attachment
 * and no admin flag receives zero groups.
 *
 * WHAT IS DELIBERATELY ABSENT, AND MUST STAY ABSENT:
 *
 * - `managedCorporations.isActive`   — a member corp with isActive=false STILL
 *   grants Mumble access today. Adding this filter would silently widen every
 *   revocation beyond current behaviour. (discord.service.ts applies isActive to
 *   its own role rule; that divergence is tracked separately and is NOT resolved
 *   here.)
 * - `managedCorporations.isAltCorp` / `isSpecialPurpose` — no filter in the rule.
 * - `userCharacters.allianceId` — alliance membership does NOT qualify on its own.
 *   (workflows/steps/user-roles/reconcile-affiliation-groups.ts uses a looser
 *   rule that also accepts any allianceId. That rule governs a different
 *   subsystem and is NOT the rule here.)
 * - `userCharacters.hasValidToken` / `status` / `is_primary` — not part of the rule.
 *
 * Changing any of the above changes who loses their account. Do not "tidy" this
 * predicate. The equivalence test in __tests__/service-eligibility.test.ts pins
 * each of these exclusions.
 */
/**
 * Derived from the schema's const so the TypeScript union and the Postgres enum
 * are the same list by construction — the scan cannot write a reason the column
 * would reject. See SERVICE_ELIGIBILITY_REASONS in db/schema.ts for each
 * subcode's meaning.
 */
export type ServiceEligibilityReason = (typeof SERVICE_ELIGIBILITY_REASONS)[number]

export interface ServiceEligibilityVerdict {
	userId: string
	eligible: boolean
	reason: ServiceEligibilityReason
}

/** The raw signals the rule is derived from. Kept separate so the per-user and
 * set-based forms can share one derivation and therefore cannot drift. */
export interface ServiceEligibilitySignals {
	/** `users.is_admin`. */
	isAdmin: boolean
	/** A non-deleted character exists in a corp with `is_member_corporation = true`. */
	hasMemberCorpCharacter: boolean
	/** Any non-deleted character exists. */
	hasAnyCharacter: boolean
	/** Any non-deleted character has a non-NULL `corporation_id`. */
	hasAnyCorporation: boolean
	/** A *deleted* character exists in a member corp — diagnostic only, never
	 * part of the eligibility decision. */
	hadDeletedMemberCorpCharacter: boolean
}

/**
 * Derive the verdict from the signals. THIS IS THE ONLY PLACE THE RULE IS
 * DECIDED — both the per-user and the set-based forms funnel through it, which
 * is what makes the equivalence test meaningful.
 */
export function deriveServiceEligibility(
	userId: string,
	signals: ServiceEligibilitySignals
): ServiceEligibilityVerdict {
	// The rule itself: member-corp attachment, or admin.
	if (signals.hasMemberCorpCharacter) {
		return { userId, eligible: true, reason: 'member_corp' }
	}
	if (signals.isAdmin) {
		// Deliberate anti-lockout: admins keep access with no member corp so an
		// incident responder cannot revoke their own comms mid-incident.
		return { userId, eligible: true, reason: 'admin_exempt' }
	}

	// Ineligible. Everything below only picks the most specific diagnostic
	// subcode — it cannot change the outcome. Ordered most-informative first:
	// "3,900 null_corp" is a broken ESI sync; "3,900 ineligible" is unreviewable.
	if (!signals.hasAnyCharacter) {
		return { userId, eligible: false, reason: 'no_characters' }
	}
	if (signals.hadDeletedMemberCorpCharacter) {
		return { userId, eligible: false, reason: 'only_deleted_member_char' }
	}
	if (!signals.hasAnyCorporation) {
		return { userId, eligible: false, reason: 'null_corp' }
	}
	return { userId, eligible: false, reason: 'unmanaged_corp' }
}

/**
 * Per-user corporation attachment check.
 *
 * Query shape is load-bearing: services/mumble.service.ts delegates to this, and
 * its tests mock `userCharacters.findMany` + `managedCorporations.findMany`
 * directly.
 */
export async function hasMemberCorporationAttachment(
	db: DbClient<typeof schema>,
	userId: string
): Promise<boolean> {
	const [characters, memberCorporations] = await Promise.all([
		db.query.userCharacters.findMany({
			where: and(eq(userCharacters.userId, userId), eq(userCharacters.isDeleted, false)),
			columns: {
				corporationId: true,
			},
		}),
		db.query.managedCorporations.findMany({
			where: eq(managedCorporations.isMemberCorporation, true),
			columns: {
				corporationId: true,
			},
		}),
	])

	const memberCorporationIds = new Set(
		memberCorporations.map((corporation) => corporation.corporationId)
	)
	return characters.some(
		(character) => !!character.corporationId && memberCorporationIds.has(character.corporationId)
	)
}

/**
 * Is this user eligible for services right now?
 *
 * Mirrors the hard cut in `getUserGroupNames` exactly
 * (`if (!hasAttachment && !user?.is_admin) return []` — services/mumble.service.ts):
 * a member-corp attachment, OR site admin.
 *
 * This exists to GATE THE SELF-SERVICE GRANT PATHS. Eligibility is derived state,
 * not stored state — it is recomputed from `is_member_corporation` on every read —
 * so revoking access is not a one-shot act: without the same predicate on the
 * grant paths, a user simply re-grants themselves and the revocation was theatre.
 *
 * Gate the ROUTES with this, never the service functions. Two of those service
 * functions are also called by enforcement itself:
 * `enforceBlacklistedMumbleAccess` calls `resetMumblePassword` to rotate a
 * blacklisted user's password *as the lockout*, and a blacklisted user is
 * ineligible — so a gate inside the service would throw there, be swallowed by
 * that call's `.catch()`, and leave the blacklisted user's credentials working.
 * `syncUserDiscordAccess` is likewise shared with the refresh workflow, the admin
 * route and two RPC surfaces.
 */
export async function isUserEligibleForServices(
	db: DbClient<typeof schema>,
	userId: string
): Promise<boolean> {
	const [user, hasAttachment] = await Promise.all([
		db.query.users.findFirst({
			where: eq(users.id, userId),
			columns: { is_admin: true },
		}),
		hasMemberCorporationAttachment(db, userId),
	])

	// `user?.is_admin` is optional-chained deliberately: a missing users row is
	// falsy, i.e. ineligible, which matches getUserGroupNames.
	return hasAttachment || user?.is_admin === true
}

/** One row of the set-based scan. `eligible`/`reason` are derived, never selected. */
export interface ServiceEligibilityScanRow extends ServiceEligibilityVerdict {
	/** `users.discord_user_id IS NOT NULL` — population membership, not eligibility. */
	hasDiscordLink: boolean
	signals: ServiceEligibilitySignals
}

/**
 * SET-BASED eligibility for a keyset-paginated page of users.
 *
 * One SQL statement per page. The per-user form costs ~2 queries per user AND
 * re-reads the entire `managed_corporations` table on every call, so a naive
 * per-user scan would exceed the Workers 10k-subrequest ceiling at roughly 1,600
 * users. This does not.
 *
 * `users` is the DRIVING TABLE and the joins are lateral EXISTS subqueries —
 * never a LEFT JOIN with a WHERE on the right side, which would silently drop
 * rows. Every EXISTS is index-backed (`user_characters_user_id_idx`,
 * `user_characters_corporation_id_idx`,
 * `managed_corporations_corporation_id_is_member_idx`).
 *
 * Booleans, not counts: `count(*)` returns bigint, which the Neon driver
 * serialises badly (see CLAUDE.md). EXISTS also short-circuits.
 *
 * @param afterUserId - keyset cursor; pass undefined for the first page
 */
export async function scanUserEligibilityPage(
	db: DbClient<typeof schema>,
	options: { afterUserId?: string; limit: number }
): Promise<ServiceEligibilityScanRow[]> {
	const { afterUserId, limit } = options

	const result = await db.execute<{
		id: string
		is_admin: boolean
		has_discord_link: boolean
		has_member_corp_character: boolean
		has_any_character: boolean
		has_any_corporation: boolean
		had_deleted_member_corp_character: boolean
	}>(sql`
		SELECT
			u.id,
			u.is_admin,
			(u.discord_user_id IS NOT NULL) AS has_discord_link,
			EXISTS (
				SELECT 1 FROM user_characters uc
				JOIN managed_corporations mc
					ON mc.corporation_id = uc.corporation_id
					AND mc.is_member_corporation = true
				WHERE uc.user_id = u.id AND uc.deleted = false
			) AS has_member_corp_character,
			EXISTS (
				SELECT 1 FROM user_characters uc
				WHERE uc.user_id = u.id AND uc.deleted = false
			) AS has_any_character,
			EXISTS (
				SELECT 1 FROM user_characters uc
				WHERE uc.user_id = u.id AND uc.deleted = false AND uc.corporation_id IS NOT NULL
			) AS has_any_corporation,
			EXISTS (
				SELECT 1 FROM user_characters uc
				JOIN managed_corporations mc
					ON mc.corporation_id = uc.corporation_id
					AND mc.is_member_corporation = true
				WHERE uc.user_id = u.id AND uc.deleted = true
			) AS had_deleted_member_corp_character
		FROM users u
		${afterUserId ? sql`WHERE u.id > ${afterUserId}::uuid` : sql``}
		ORDER BY u.id
		LIMIT ${limit}
	`)

	return result.rows.map((row) => {
		const signals: ServiceEligibilitySignals = {
			isAdmin: row.is_admin,
			hasMemberCorpCharacter: row.has_member_corp_character,
			hasAnyCharacter: row.has_any_character,
			hasAnyCorporation: row.has_any_corporation,
			hadDeletedMemberCorpCharacter: row.had_deleted_member_corp_character,
		}
		return {
			...deriveServiceEligibility(row.id, signals),
			hasDiscordLink: row.has_discord_link,
			signals,
		}
	})
}

/**
 * The eligibility BASIS: every corporation the rule currently treats as a member
 * corporation.
 *
 * This is snapshotted onto every run because it is the input that can silently
 * invert the rule. `is_member_corporation` is `.default(false).notNull()`
 * (db/schema.ts) — i.e. the basis DEFAULTS TO THE REVOKING VALUE. An empty or
 * half-restored `managed_corporations` does not degrade the rule, it inverts it,
 * and every non-admin becomes a target. Callers MUST run the basis assertions in
 * lib/service-eligibility-basis.ts before acting on a scan.
 */
export async function getMemberCorporationBasis(
	db: DbClient<typeof schema>
): Promise<{ corporationIds: string[]; count: number }> {
	const rows = await db.query.managedCorporations.findMany({
		where: eq(managedCorporations.isMemberCorporation, true),
		columns: {
			corporationId: true,
		},
	})

	const corporationIds = rows.map((row) => row.corporationId)
	return { corporationIds, count: corporationIds.length }
}
