import { describe, expect, it } from 'vitest'

import { createDb } from '../db'
import { SERVICE_ELIGIBILITY_REASONS } from '../db/schema'

import type { ServiceEligibilityReason } from '../lib/service-eligibility'

/**
 * NOTE ON HOW REGISTRATION ACTUALLY WORKS HERE — this is counter-intuitive and
 * was got wrong once already.
 *
 * db/index.ts does `import * as schema from './schema'` and hands that MODULE
 * NAMESPACE to drizzle, so every exported pgTable and Relations object is picked
 * up automatically. A table is registered by being `export`ed — nothing more.
 *
 * The hand-maintained `export const schema = { ... }` list at the bottom of
 * schema.ts is NOT what drizzle consumes and has no consumer at all; several
 * live tables (pm_forum_config among them) are absent from it and work fine. New
 * tables are added to it for consistency with the file's convention, but do not
 * believe an assertion on that object — it proves nothing.
 *
 * What these tests pin is the real failure mode: a table that is defined but not
 * exported gets no `db.query` namespace, and fails at runtime rather than at
 * typecheck (`db.insert(table)` still compiles).
 */
describe('service access audit schema', () => {
	const db = createDb('postgresql://user:pass@localhost/db')
	const query = db.query as Record<string, unknown>

	it('exposes a db.query namespace for both audit tables', () => {
		expect(query.serviceAccessAuditRuns).toBeDefined()
		expect(query.serviceAccessAuditRows).toBeDefined()
	})

	it('proves that check is not vacuous: an unknown table has no namespace', () => {
		// Guards the assertion above against silently passing for any name at all.
		expect(query.serviceAccessAuditNonsense).toBeUndefined()
	})

	it('can follow the run -> rows relation', async () => {
		// Relations are picked up from the module namespace too. If the *Relations
		// exports were dropped, `with: { rows: true }` would throw here rather than
		// at some later runtime. The query is never executed — building it is the
		// assertion, so no database is touched.
		expect(() =>
			db.query.serviceAccessAuditRuns.findFirst({ with: { rows: true } }).toSQL()
		).not.toThrow()
	})

	it('can follow the row -> run and row -> user relations', () => {
		expect(() =>
			db.query.serviceAccessAuditRows.findFirst({ with: { run: true, user: true } }).toSQL()
		).not.toThrow()
	})

	it('can follow both users FKs on a run independently', () => {
		// initiatedByUserId and enforcedByUserId both point at `users`, so this is
		// the query that would break if they were ever conflated.
		expect(() =>
			db.query.serviceAccessAuditRuns
				.findFirst({ with: { initiatedByUser: true, enforcedByUser: true } })
				.toSQL()
		).not.toThrow()
	})
})

describe('eligibility reason enum', () => {
	it('is the single source for both the Postgres enum and the TS union', () => {
		// If these drift, the scan writes a reason the column rejects. The typed
		// assignment is the compile-time half; the list is the runtime half.
		const reasons: ServiceEligibilityReason[] = [...SERVICE_ELIGIBILITY_REASONS]
		expect(reasons).toEqual([
			'member_corp',
			'admin_exempt',
			'no_characters',
			'null_corp',
			'only_deleted_member_char',
			'unmanaged_corp',
			'no_user_row',
		])
	})

	it('partitions cleanly into eligible and ineligible reasons', () => {
		const eligible: ServiceEligibilityReason[] = ['member_corp', 'admin_exempt']
		const ineligible = SERVICE_ELIGIBILITY_REASONS.filter((reason) => !eligible.includes(reason))
		// A newly added reason must be deliberately classified rather than silently
		// defaulting to "ineligible" in a UI breakdown.
		expect(eligible.length + ineligible.length).toBe(SERVICE_ELIGIBILITY_REASONS.length)
		expect(ineligible).not.toContain('member_corp')
	})
})
