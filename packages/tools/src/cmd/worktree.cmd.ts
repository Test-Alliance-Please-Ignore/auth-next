import { Command } from '@commander-js/extra-typings'

import { getRepoRoot } from '../path'

/**
 * `runx worktree` — helpers for working with git worktrees using this repo's conventions.
 *
 * The main verb is `new`, which:
 *   1. Creates a worktree at `worktrees/<name>` (already git-ignored via the repo's
 *      `/worktrees/` rule, so nothing leaks into `git status`).
 *   2. Registers the worktree's branch in `git machete` (worktree-created branches do NOT
 *      auto-register — see CLAUDE.md — so we add it explicitly with `--onto <parent>`).
 *   3. Copies local secret files (`.dev.vars`, `.env`, …) from the primary working tree into
 *      the new worktree so local dev works immediately.
 *   4. Optionally (`--neon`) creates a Neon branch in the `auth-ng` project and wires its
 *      pooled / direct connection strings into the new worktree's root `.env`.
 *   5. Runs `pnpm install` in the new worktree (skip with `--no-install`) so it's ready to run.
 */

// ---------------------------------------------------------------------------
// Neon `auth-ng` project coordinates.
//
// Resolved via `neonctl projects list`. `neonctl` prompts interactively to pick an
// organization when several are available, so both the project id AND the org id must be
// passed on every call to keep the utility non-interactive. Override with the flags below if
// these ever change (or set NEON_AUTH_NG_PROJECT_ID / NEON_AUTH_NG_ORG_ID in the environment).
// ---------------------------------------------------------------------------
const DEFAULT_AUTH_NG_PROJECT_ID = 'shy-butterfly-49773526'
const DEFAULT_AUTH_NG_ORG_ID = 'org-lingering-term-04973573'

/**
 * Glob patterns for the local secret files we copy into a new worktree. These are all
 * git-ignored, so a freshly-created worktree starts without them — hence the copy.
 */
const ENV_GLOBS = [
	'**/.dev.vars',
	'**/.dev.vars.*',
	'**/.env',
	'**/.env.*',
	'**/.secret',
	'**/env.secrets.json',
] as const

/** Heavy / irrelevant directories to prune while searching for env files. */
const ENV_IGNORE = [
	'**/node_modules/**',
	'**/.git/**',
	'worktrees/**',
	'**/.wrangler/**',
	'**/.turbo/**',
	'**/dist/**',
	'**/.next/**',
	'**/out/**',
	'**/coverage/**',
] as const

export const worktreeCmd = new Command('worktree')
	.alias('wt')
	.description('Create and manage git worktrees using this repo’s conventions')

// ---------------------------------------------------------------------------
// worktree new
// ---------------------------------------------------------------------------
worktreeCmd
	.command('new')
	.alias('create')
	.description('Create a git-ignored worktree, register it in git machete, and copy env files')
	.argument('<name>', 'Worktree directory name (also the branch name unless --branch is given)')
	.option('-b, --branch <branch>', 'Git branch to create/use for the worktree (default: <name>)')
	.option('--base <ref>', 'Git ref to fork the new branch from', 'main')
	.option('--onto <parent>', 'git machete parent branch (default: base branch if local, else main)')
	.option('--no-copy-env', 'Do not copy .dev.vars / .env files into the new worktree')
	.option('-n, --neon', 'Create a Neon branch in the auth-ng project and wire it into .env')
	.option('--neon-branch <name>', 'Name for the Neon branch (default: the git branch name)')
	.option(
		'--neon-project <id>',
		'Override the Neon project id',
		process.env.NEON_AUTH_NG_PROJECT_ID
	)
	.option('--neon-org <id>', 'Override the Neon org id', process.env.NEON_AUTH_NG_ORG_ID)
	.option('--no-install', 'Skip running `pnpm install` in the new worktree')
	.option('--open', 'Open the new worktree in your editor ($EDITOR or VS Code) when done', false)
	.action(async (name, opts) => {
		const branch = opts.branch ?? name

		// Guard against path traversal / nested paths in the directory name. The branch may
		// contain slashes (e.g. `feat/foo`), but the on-disk directory name may not.
		if (name.includes('/') || name.includes('\\') || name.startsWith('.')) {
			throw new Error(
				`Invalid worktree name '${name}'. Use a plain directory name (no slashes); ` +
					`pass --branch if the branch needs slashes.`
			)
		}

		// Anchor to the primary working tree so worktrees always land in the same place (and never
		// nest) no matter which worktree this command is invoked from.
		const repoRoot = await getMainWorktreeRoot()

		// machete parent: explicit --onto, else the base branch when it's a local branch, else main
		// (a non-local base such as `origin/main` or a raw SHA cannot be a machete parent).
		const onto = opts.onto ?? ((await isLocalBranch(repoRoot, opts.base)) ? opts.base : 'main')

		const worktreesDir = path.join(repoRoot, 'worktrees')
		const worktreePath = path.join(worktreesDir, name)

		if (await fs.pathExists(worktreePath)) {
			throw new Error(`Path already exists: ${worktreePath}`)
		}

		// -------------------------------------------------------------------
		// 1. Create the worktree (+ branch).
		// -------------------------------------------------------------------
		const branchExists = await isLocalBranch(repoRoot, branch)

		echo(chalk.cyan(`▸ Creating worktree ${chalk.bold(path.relative(repoRoot, worktreePath))} …`))
		await fs.ensureDir(worktreesDir)

		if (branchExists) {
			echo(chalk.grey(`  branch '${branch}' already exists — checking it out in the worktree`))
			await $`git -C ${repoRoot} worktree add ${worktreePath} ${branch}`
		} else {
			echo(chalk.grey(`  creating branch '${branch}' from '${opts.base}'`))
			await $`git -C ${repoRoot} worktree add -b ${branch} ${worktreePath} ${opts.base}`
		}
		echo(chalk.green(`  ✔ worktree created at ${worktreePath}`))

		// -------------------------------------------------------------------
		// 2. Register the branch in git machete (worktree branches don't auto-register).
		// -------------------------------------------------------------------
		echo(chalk.cyan(`▸ Registering '${branch}' in git machete (onto '${onto}') …`))
		const macheteResult =
			await $`git -C ${repoRoot} machete add -y --onto ${onto} ${branch}`.nothrow()
		if (macheteResult.exitCode === 0) {
			echo(chalk.green(`  ✔ registered in git machete`))
		} else {
			// Non-fatal: the worktree is already usable. Surface the error so the user can fix
			// the machete tree manually rather than silently swallowing it.
			echo(
				chalk.yellow(
					`  ⚠ could not register in git machete (exit ${macheteResult.exitCode}). ` +
						`Add it manually: git machete add ${branch} --onto ${onto}`
				)
			)
			echo(chalk.grey(macheteResult.stderr.trim()))
		}

		// -------------------------------------------------------------------
		// 3. Copy local env / secret files into the new worktree.
		// -------------------------------------------------------------------
		if (opts.copyEnv) {
			await copyEnvFiles(repoRoot, worktreePath)
		} else {
			echo(chalk.grey('▸ Skipping env-file copy (--no-copy-env)'))
		}

		// -------------------------------------------------------------------
		// 4. Optional: create a Neon branch and wire it into the worktree's .env.
		// -------------------------------------------------------------------
		if (opts.neon) {
			const neonBranch = opts.neonBranch ?? branch
			const projectId = opts.neonProject ?? DEFAULT_AUTH_NG_PROJECT_ID
			const orgId = opts.neonOrg ?? DEFAULT_AUTH_NG_ORG_ID
			try {
				await setupNeonBranch({ worktreePath, neonBranch, projectId, orgId })
			} catch (err) {
				// Non-fatal: the worktree is already created and usable. Surface the error plus a
				// concrete cleanup path so the user isn't left with a half-configured/orphaned state.
				echo(chalk.yellow(`  ⚠ Neon setup failed: ${(err as Error).message}`))
				echo(chalk.grey('    The worktree is ready without DB wiring. If a Neon branch was'))
				echo(chalk.grey('    created before the failure, delete the orphan with:'))
				echo(
					chalk.grey(
						`      neonctl branches delete ${neonBranch} --project-id ${projectId} --org-id ${orgId}`
					)
				)
			}
		}

		// -------------------------------------------------------------------
		// 5. Install dependencies (unless --no-install), then optionally open the editor.
		// -------------------------------------------------------------------
		let installFailed = false
		if (opts.install) {
			echo(chalk.cyan('▸ Installing dependencies (pnpm install) …'))
			// Inherit stdio so pnpm's progress is visible; non-fatal so a failed install still leaves
			// a usable worktree (the user can just re-run install).
			const res = await $({
				stdio: 'inherit',
			})`pnpm -C ${worktreePath} install --child-concurrency=10`.nothrow()
			if (res.exitCode === 0) {
				echo(chalk.green('  ✔ dependencies installed'))
			} else {
				installFailed = true
				echo(chalk.yellow(`  ⚠ pnpm install failed (exit ${res.exitCode}) — re-run it manually`))
			}
		}

		if (opts.open) {
			await openInEditor(worktreePath)
		}

		echo('')
		echo(chalk.green.bold('✔ Worktree ready.'))
		echo(chalk.grey(`  cd ${path.relative(process.cwd(), worktreePath) || worktreePath}`))
		if (!opts.install || installFailed) {
			echo(chalk.grey(`  pnpm -C ${worktreePath} install   # install dependencies`))
		}
	})

// ---------------------------------------------------------------------------
// worktree list
// ---------------------------------------------------------------------------
worktreeCmd
	.command('list')
	.alias('ls')
	.description('List all git worktrees')
	.action(async () => {
		const repoRoot = await getMainWorktreeRoot()
		$.stdio = 'inherit'
		await $`git -C ${repoRoot} worktree list`
	})

// ---------------------------------------------------------------------------
// worktree rm
// ---------------------------------------------------------------------------
worktreeCmd
	.command('rm')
	.alias('remove')
	.description('Remove a worktree and de-register its branch from git machete')
	.argument('<name>', 'Worktree directory name under worktrees/')
	.option('--delete-branch', 'Also delete the git branch (git branch -D)', false)
	.option('--delete-neon <name>', 'Also delete the named Neon branch from the auth-ng project')
	.option(
		'--neon-project <id>',
		'Override the Neon project id',
		process.env.NEON_AUTH_NG_PROJECT_ID
	)
	.option('--neon-org <id>', 'Override the Neon org id', process.env.NEON_AUTH_NG_ORG_ID)
	.option('-f, --force', 'Force removal even with uncommitted changes / skip confirmation', false)
	.action(async (name, opts) => {
		const repoRoot = await getMainWorktreeRoot()
		const worktreePath = path.join(repoRoot, 'worktrees', name)

		if (!(await fs.pathExists(worktreePath))) {
			throw new Error(`No worktree directory at ${worktreePath}`)
		}

		// Resolve the branch checked out in that worktree so we can clean up machete afterwards.
		// A detached-HEAD worktree reports the literal 'HEAD' — treat that as "no branch".
		const rawBranch = (
			await $`git -C ${worktreePath} rev-parse --abbrev-ref HEAD`.nothrow()
		).stdout.trim()
		const branch = rawBranch === 'HEAD' ? '' : rawBranch

		if (!opts.force) {
			const answer = await question(
				chalk.yellow(
					`Remove worktree '${name}' (${branch ? `branch '${branch}'` : 'detached HEAD'})? [y/N] `
				)
			)
			if (!/^y(es)?$/i.test(answer.trim())) {
				echo(chalk.grey('Aborted.'))
				return
			}
		}

		echo(chalk.cyan(`▸ Removing worktree ${name} …`))
		await $`git -C ${repoRoot} worktree remove ${opts.force ? ['--force'] : []} ${worktreePath}`
		echo(chalk.green('  ✔ worktree removed'))

		if (opts.deleteBranch && branch) {
			// Detach the branch from the machete layout first (best-effort — slide-out reconnects
			// any children to the parent), then delete the branch itself.
			await $`git -C ${repoRoot} machete slide-out ${branch}`.nothrow()
			echo(chalk.cyan(`▸ Deleting branch ${branch} …`))
			const del = await $`git -C ${repoRoot} branch -D ${branch}`.nothrow()
			echo(
				del.exitCode === 0
					? chalk.green('  ✔ branch deleted')
					: chalk.yellow(`  ⚠ could not delete branch: ${del.stderr.trim()}`)
			)
		} else if (branch) {
			echo(
				chalk.grey(
					`  branch '${branch}' kept. To prune it from git machete later: git machete slide-out ${branch}`
				)
			)
		}

		if (opts.deleteNeon) {
			const projectId = opts.neonProject ?? DEFAULT_AUTH_NG_PROJECT_ID
			const orgId = opts.neonOrg ?? DEFAULT_AUTH_NG_ORG_ID
			echo(chalk.cyan(`▸ Deleting Neon branch '${opts.deleteNeon}' from auth-ng …`))
			const del =
				await $`neonctl branches delete ${opts.deleteNeon} --project-id ${projectId} --org-id ${orgId}`.nothrow()
			echo(
				del.exitCode === 0
					? chalk.green('  ✔ Neon branch deleted')
					: chalk.yellow(`  ⚠ could not delete Neon branch: ${del.stderr.trim()}`)
			)
		}

		echo(chalk.green.bold('✔ Done.'))
	})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Copy git-ignored env/secret files from `srcRoot` into the same relative paths under
 * `destRoot`. Never overwrites (a fresh worktree shouldn't have them anyway) and never prints
 * file contents.
 */
async function copyEnvFiles(srcRoot: string, destRoot: string): Promise<void> {
	echo(chalk.cyan('▸ Copying local env files …'))

	const matches = await glob([...ENV_GLOBS], {
		cwd: srcRoot,
		dot: true,
		ignore: [...ENV_IGNORE],
		onlyFiles: true,
	})

	// Skip `*.example` templates — we only want the real, filled-in secret files.
	const files = matches
		.filter((rel) => !path.basename(rel).includes('.example'))
		.sort((a, b) => a.localeCompare(b))

	if (files.length === 0) {
		echo(chalk.grey('  (no env files found to copy)'))
		return
	}

	let copied = 0
	for (const rel of files) {
		const src = path.join(srcRoot, rel)
		const dest = path.join(destRoot, rel)
		if (await fs.pathExists(dest)) {
			echo(chalk.grey(`  ∙ skip (exists): ${rel}`))
			continue
		}
		await fs.ensureDir(path.dirname(dest))
		await fs.copy(src, dest)
		await fs.chmod(dest, 0o600) // secrets: keep copies owner-readable only
		echo(chalk.grey(`  ∙ ${rel}`))
		copied++
	}
	echo(chalk.green(`  ✔ copied ${copied} env file${copied === 1 ? '' : 's'}`))
}

/**
 * Create (or reuse) a Neon branch in the auth-ng project, then write its pooled connection
 * string to DATABASE_URL and its direct connection string to DATABASE_URL_MIGRATIONS in the
 * new worktree's root `.env`. Only those two keys are touched; every other line is preserved.
 */
async function setupNeonBranch(args: {
	worktreePath: string
	neonBranch: string
	projectId: string
	orgId: string
}): Promise<void> {
	const { worktreePath, neonBranch, projectId, orgId } = args
	echo(chalk.cyan(`▸ Creating Neon branch '${neonBranch}' in auth-ng (${projectId}) …`))

	const create =
		await $`neonctl branches create --project-id ${projectId} --org-id ${orgId} --name ${neonBranch} --output json`.nothrow()

	if (create.exitCode !== 0) {
		const stderr = create.stderr.toLowerCase()
		if (stderr.includes('already exists')) {
			echo(chalk.yellow(`  ⚠ Neon branch '${neonBranch}' already exists — reusing it`))
		} else {
			throw new Error(`Failed to create Neon branch '${neonBranch}':\n${create.stderr.trim()}`)
		}
	} else {
		echo(chalk.green(`  ✔ Neon branch created`))
	}

	// Fetch both connection strings. `--pooled` returns the PgBouncer pooler host (good for the
	// serverless driver at runtime); omitting it returns the direct host (needed for migrations).
	const getConn = async (pooled: boolean): Promise<string> => {
		const flags = pooled ? ['--pooled'] : []
		const res =
			await $`neonctl connection-string ${neonBranch} --project-id ${projectId} --org-id ${orgId} ${flags}`.nothrow()
		if (res.exitCode !== 0) {
			throw new Error(
				`Failed to get ${pooled ? 'pooled' : 'direct'} connection string:\n${res.stderr.trim()}`
			)
		}
		return res.stdout.trim()
	}

	const [pooledUrl, directUrl] = await Promise.all([getConn(true), getConn(false)])

	// Wire into the worktree's root .env (create it if the copy step didn't produce one).
	const envPath = path.join(worktreePath, '.env')
	const existing = (await fs.pathExists(envPath)) ? await fs.readFile(envPath, 'utf8') : ''
	let next = upsertEnvVar(existing, 'DATABASE_URL', pooledUrl)
	next = upsertEnvVar(next, 'DATABASE_URL_MIGRATIONS', directUrl)
	if (!next.endsWith('\n')) next += '\n'
	// 0600: this file now holds live DB credentials — keep it owner-readable only. `mode` only
	// applies on creation, so chmod as well in case the copy step already produced the file.
	await fs.writeFile(envPath, next, { mode: 0o600 })
	await fs.chmod(envPath, 0o600)

	echo(chalk.green(`  ✔ wired connection strings into ${path.basename(worktreePath)}/.env`))
	// Print masked URLs only — the full credentials are written to .env, not the terminal / CI log.
	echo(chalk.grey(`    DATABASE_URL (pooled):            ${maskConnString(pooledUrl)}`))
	echo(chalk.grey(`    DATABASE_URL_MIGRATIONS (direct): ${maskConnString(directUrl)}`))
}

/**
 * Set `key=value` in the contents of a `.env` file. Replaces the first uncommented assignment
 * of `key` if present; otherwise appends a new line. Returns the updated contents.
 */
function upsertEnvVar(contents: string, key: string, value: string): string {
	const line = `${key}=${value}`
	const re = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm')
	if (re.test(contents)) {
		// Use a replacer function so `$` sequences in the value (e.g. in a password) are written
		// literally rather than interpreted as `String.prototype.replace` substitution patterns.
		return contents.replace(re, () => line)
	}
	const sep = contents.length === 0 || contents.endsWith('\n') ? '' : '\n'
	return `${contents}${sep}${line}\n`
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Open a path in the user's editor. Prefers $EDITOR, falls back to VS Code (`code`). */
async function openInEditor(target: string): Promise<void> {
	let cmd = process.env.EDITOR
	if (!cmd) {
		const hasCode = (await $`command -v code`.nothrow()).exitCode === 0
		cmd = hasCode ? 'code' : undefined
	}
	if (!cmd) {
		echo(chalk.grey('  (no $EDITOR set and `code` not found — skipping --open)'))
		return
	}
	// $EDITOR may include flags (e.g. "code --wait" / "code -n"), so split into program + args.
	// Inherit stdio so terminal editors (vim, nano) attach to the TTY, and surface a non-zero
	// exit instead of silently swallowing it.
	const [bin, ...editorArgs] = cmd.split(/\s+/).filter(Boolean)
	if (!bin) return
	const res = await $({ stdio: 'inherit' })`${bin} ${editorArgs} ${target}`.nothrow()
	if (res.exitCode !== 0) {
		echo(chalk.yellow(`  (failed to open editor '${cmd}' — exit ${res.exitCode})`))
	}
}

/**
 * Resolve the primary working tree's root, independent of which worktree the command runs in.
 * git's common dir (`<mainRoot>/.git`) is shared by every linked worktree, so its parent is the
 * canonical repo root. This is deliberately NOT `getRepoRoot()`, which walks up to the nearest
 * `pnpm-lock.yaml` — a tracked file present at the root of every worktree — and would therefore
 * return the current worktree (causing nested `worktrees/a/worktrees/b` and list/rm mismatches).
 */
async function getMainWorktreeRoot(): Promise<string> {
	const commonDir = (
		await $`git rev-parse --path-format=absolute --git-common-dir`.nothrow()
	).stdout.trim()
	// commonDir is an absolute path ending in `/.git`; its parent is the primary working tree.
	if (commonDir) {
		return path.dirname(commonDir)
	}
	// Fallback for non-git contexts (should not happen inside this repo).
	return getRepoRoot()
}

/** Whether `ref` resolves to a local branch (`refs/heads/<ref>`) in the given repo. */
async function isLocalBranch(repoRoot: string, ref: string): Promise<boolean> {
	return (
		(await $`git -C ${repoRoot} rev-parse --verify --quiet ${'refs/heads/' + ref}`.nothrow())
			.exitCode === 0
	)
}

/** Redact the password in a postgres connection string (`//user:pass@` → `//user:***@`). */
function maskConnString(url: string): string {
	return url.replace(/(\/\/[^:@/]+:)[^@]*(@)/, (_m, pre, at) => `${pre}***${at}`)
}
