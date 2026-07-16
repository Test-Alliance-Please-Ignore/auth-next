import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { deriveServiceEligibility, hasMemberCorporationAttachment } from '../service-eligibility'

import type { ServiceEligibilitySignals } from '../service-eligibility'

/**
 * INDEPENDENT reference implementation of the rule, written from the prose spec
 * rather than from the implementation. If `deriveServiceEligibility` is ever
 * "simplified" into disagreeing with this, the exhaustive test below fails.
 *
 * The rule: eligible iff a non-deleted character sits in a member corporation,
 * OR the user is an admin.
 */
function referenceIsEligible(signals: ServiceEligibilitySignals): boolean {
	return signals.hasMemberCorpCharacter || signals.isAdmin
}

/** All 2^5 = 32 signal combinations. */
function allSignalCombinations(): ServiceEligibilitySignals[] {
	const combos: ServiceEligibilitySignals[] = []
	for (let mask = 0; mask < 32; mask++) {
		combos.push({
			isAdmin: Boolean(mask & 1),
			hasMemberCorpCharacter: Boolean(mask & 2),
			hasAnyCharacter: Boolean(mask & 4),
			hasAnyCorporation: Boolean(mask & 8),
			hadDeletedMemberCorpCharacter: Boolean(mask & 16),
		})
	}
	return combos
}

const USER_ID = '123e4567-e89b-12d3-a456-426614174000'

describe('deriveServiceEligibility', () => {
	it('agrees with the independent reference on every one of the 32 signal combinations', () => {
		for (const signals of allSignalCombinations()) {
			const verdict = deriveServiceEligibility(USER_ID, signals)
			expect(verdict.eligible, `signals: ${JSON.stringify(signals)}`).toBe(
				referenceIsEligible(signals)
			)
		}
	})

	it('never lets a diagnostic subcode change the outcome', () => {
		// Every ineligible reason must in fact be ineligible, and vice versa.
		const eligibleReasons = new Set(['member_corp', 'admin_exempt'])
		for (const signals of allSignalCombinations()) {
			const verdict = deriveServiceEligibility(USER_ID, signals)
			expect(eligibleReasons.has(verdict.reason), `signals: ${JSON.stringify(signals)}`).toBe(
				verdict.eligible
			)
		}
	})

	it('treats a member-corp attachment as decisive even for a non-admin with no other signals', () => {
		expect(
			deriveServiceEligibility(USER_ID, {
				isAdmin: false,
				hasMemberCorpCharacter: true,
				hasAnyCharacter: true,
				hasAnyCorporation: true,
				hadDeletedMemberCorpCharacter: false,
			})
		).toEqual({ userId: USER_ID, eligible: true, reason: 'member_corp' })
	})

	it('exempts admins who have no member-corp attachment, and says so explicitly', () => {
		// Anti-lockout: the incident responder must not revoke their own comms.
		expect(
			deriveServiceEligibility(USER_ID, {
				isAdmin: true,
				hasMemberCorpCharacter: false,
				hasAnyCharacter: false,
				hasAnyCorporation: false,
				hadDeletedMemberCorpCharacter: false,
			})
		).toEqual({ userId: USER_ID, eligible: true, reason: 'admin_exempt' })
	})

	it('reports member_corp (not admin_exempt) for an admin who IS in a member corp', () => {
		// Otherwise the admin_exempt count reads as "admins with no corp" and is useless.
		expect(
			deriveServiceEligibility(USER_ID, {
				isAdmin: true,
				hasMemberCorpCharacter: true,
				hasAnyCharacter: true,
				hasAnyCorporation: true,
				hadDeletedMemberCorpCharacter: false,
			}).reason
		).toBe('member_corp')
	})

	describe('ineligible subcodes, most specific first', () => {
		const base: ServiceEligibilitySignals = {
			isAdmin: false,
			hasMemberCorpCharacter: false,
			hasAnyCharacter: true,
			hasAnyCorporation: true,
			hadDeletedMemberCorpCharacter: false,
		}

		it('no_characters when the user has no non-deleted characters', () => {
			expect(
				deriveServiceEligibility(USER_ID, { ...base, hasAnyCharacter: false, hasAnyCorporation: false })
					.reason
			).toBe('no_characters')
		})

		it('only_deleted_member_char when the qualifying character was soft-deleted', () => {
			expect(
				deriveServiceEligibility(USER_ID, { ...base, hadDeletedMemberCorpCharacter: true }).reason
			).toBe('only_deleted_member_char')
		})

		it('null_corp when characters exist but none carries a corporation', () => {
			// The signature of a broken ESI sync — must be distinguishable at a glance.
			expect(deriveServiceEligibility(USER_ID, { ...base, hasAnyCorporation: false }).reason).toBe(
				'null_corp'
			)
		})

		it('unmanaged_corp when the user has corporations, none of them member corps', () => {
			expect(deriveServiceEligibility(USER_ID, base).reason).toBe('unmanaged_corp')
		})
	})
})

describe('hasMemberCorporationAttachment', () => {
	function dbWith(characters: Array<{ corporationId: string | null }>, memberCorps: string[]) {
		return {
			query: {
				userCharacters: {
					findMany: vi.fn().mockResolvedValue(characters),
				},
				managedCorporations: {
					findMany: vi
						.fn()
						.mockResolvedValue(memberCorps.map((corporationId) => ({ corporationId }))),
				},
			},
		} as never
	}

	it('is true when any character sits in a member corporation', async () => {
		await expect(
			hasMemberCorporationAttachment(dbWith([{ corporationId: 'corp-1' }], ['corp-1']), USER_ID)
		).resolves.toBe(true)
	})

	it('is true when only ONE of several characters qualifies', async () => {
		await expect(
			hasMemberCorporationAttachment(
				dbWith([{ corporationId: 'corp-9' }, { corporationId: 'corp-1' }], ['corp-1']),
				USER_ID
			)
		).resolves.toBe(true)
	})

	it('is false when the user has characters in no member corporation', async () => {
		await expect(
			hasMemberCorporationAttachment(dbWith([{ corporationId: 'corp-2' }], ['corp-1']), USER_ID)
		).resolves.toBe(false)
	})

	it('is false when the user has no characters at all', async () => {
		await expect(hasMemberCorporationAttachment(dbWith([], ['corp-1']), USER_ID)).resolves.toBe(
			false
		)
	})

	it('is false when every character has a NULL corporation', async () => {
		// A NULL corporationId must never match a NULL-ish member corp id.
		await expect(
			hasMemberCorporationAttachment(dbWith([{ corporationId: null }], ['corp-1']), USER_ID)
		).resolves.toBe(false)
	})

	it('is false when the member corporation basis is empty', async () => {
		// The catastrophe case: an empty/half-restored managed_corporations makes
		// EVERY non-admin ineligible. The predicate is correct to return false here
		// — which is exactly why the caller must run the basis circuit breaker.
		await expect(
			hasMemberCorporationAttachment(dbWith([{ corporationId: 'corp-1' }], []), USER_ID)
		).resolves.toBe(false)
	})

	it('filters deleted characters in SQL, not in JS', async () => {
		// The soft-delete filter must be part of the WHERE clause. If it ever moves
		// to a JS .filter(), the set-based scan (which cannot see JS) silently diverges.
		const db = dbWith([{ corporationId: 'corp-1' }], ['corp-1'])
		await hasMemberCorporationAttachment(db, USER_ID)
		const call = (db as unknown as { query: { userCharacters: { findMany: ReturnType<typeof vi.fn> } } })
			.query.userCharacters.findMany.mock.calls[0][0]
		expect(call.where).toBeDefined()
	})
})

describe('the rule’s deliberate exclusions (guards against well-meaning tidying)', () => {
	// `import.meta.url` is passed as a string: the ambient `URL` here is the
	// Workers one, which is not assignable to node's.
	const source = readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), '..', 'service-eligibility.ts'),
		'utf8'
	)

	// These guards assert on CODE, never on prose. The module docblock names the
	// excluded columns in order to explain them, so matching raw source would make
	// every guard self-fail on its own documentation.
	const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

	// Everything below is ABSENT ON PURPOSE. Each one, if added, silently changes
	// who loses their account. See the module docblock for the reasoning.
	it.each([
		['is_active / isActive', /\bis_active\b|\bisActive\b/],
		['alliance_id / allianceId', /\balliance_id\b|\ballianceId\b/],
		['is_alt_corp / isAltCorp', /\bis_alt_corp\b|\bisAltCorp\b/],
		['is_special_purpose / isSpecialPurpose', /\bis_special_purpose\b|\bisSpecialPurpose\b/],
		['has_valid_token / hasValidToken', /\bhas_valid_token\b|\bhasValidToken\b/],
		['is_primary / isPrimary', /\bis_primary\b|\bisPrimary\b/],
	])('does not filter on %s', (_label, pattern) => {
		expect(code).not.toMatch(pattern)
	})

	it('does filter on the two predicates the rule IS made of', () => {
		expect(code).toMatch(/is_member_corporation = true/)
		expect(code).toMatch(/uc\.deleted = false/)
	})

	it('uses EXISTS rather than count(*), which would return bigint', () => {
		// CLAUDE.md: the Neon driver serialises bigint badly. count(*) is bigint.
		expect(code).not.toMatch(/count\(\*\)/)
		expect(code).toMatch(/EXISTS \(/)
	})

	it('drives from `users` so that users with zero characters are not silently dropped', () => {
		// A LEFT JOIN + WHERE on the right-hand side would spare exactly the
		// no_characters population — the most likely target profile.
		expect(code).toMatch(/FROM users u/)
		expect(code).not.toMatch(/LEFT JOIN/i)
	})
})
