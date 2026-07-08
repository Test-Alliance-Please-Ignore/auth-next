/**
 * Vitest globalSetup for the money-flow integration tests.
 *
 * Provisions a FRESH ephemeral Neon branch per run (a schema-only copy of the shared test parent),
 * exposes its connection string as TEST_DATABASE_URL, and deletes the branch on teardown — so every
 * run starts from a clean, isolated database and leaves nothing behind.
 *
 * No migrate step: a schema-only branch inherits the parent's already-applied pm_* schema (the parent
 * is a maintained/deployed branch). Re-running migrations would conflict, since the DDL is present but
 * the copied migration journal has no rows. Keep the parent branch's schema current.
 *
 * Opt-in by credentials: with no NEON_API_KEY / NEON_PROJECT_ID this is a no-op and the tests skip
 * (see the `describe.skipIf` guard in money-flow.int.test.ts), so `just test` stays green in
 * environments without Neon secrets. CI wires the secrets in to run it for real.
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { TestBranchManager } from '@repo/db-utils'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Mirror src/scripts/migrate.ts: load the monorepo-root .env so local runs pick up NEON_* creds.
// (Note: a shell that already exports NEON_* shadows these — dotenv does not override existing vars.)
config({ path: resolve(__dirname, '../../../../../.env') })

export default async function setup(): Promise<(() => Promise<void>) | void> {
	const NEON_API_KEY = process.env.NEON_API_KEY
	const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID
	if (!NEON_API_KEY || !NEON_PROJECT_ID) {
		console.warn(
			'[pm:int] NEON_API_KEY / NEON_PROJECT_ID not set — money-flow integration tests will be skipped'
		)
		return
	}

	const manager = new TestBranchManager({ NEON_API_KEY, NEON_PROJECT_ID })
	// Shared monorepo test parent (override in CI via NEON_TEST_PARENT_BRANCH_ID). schema-only ⇒ the
	// branch inherits the parent's pm_* DDL with no row data.
	const parentBranchId = process.env.NEON_TEST_PARENT_BRANCH_ID ?? 'br-aged-credit-adf5wd07'

	const connectionUrl = await manager.createBranch({
		branchName: `test-pm-${crypto.randomUUID()}`,
		parentBranchId,
		schemaOnly: true,
		// `direct` (non-pooler) endpoint — safest for the interactive FOR UPDATE / advisory-lock
		// transactions placeBet and updateConfig rely on.
		endpoint: 'direct',
	})

	try {
		process.env.TEST_DATABASE_URL = connectionUrl
	} catch (err) {
		// Never orphan a branch if post-provision setup fails.
		await manager.deleteBranch().catch(() => {})
		throw err
	}

	return async () => {
		delete process.env.TEST_DATABASE_URL
		await manager.deleteBranch()
	}
}
