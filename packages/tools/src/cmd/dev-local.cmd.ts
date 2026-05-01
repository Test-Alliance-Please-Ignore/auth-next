import { Command } from '@commander-js/extra-typings'

import { getRepoRoot } from '../path'

const sanitizeNodeOptions = (value: string | undefined): string | undefined => {
	if (!value) return undefined
	const sanitized = value
		.split(/\s+/)
		.filter((part) => part.length > 0 && !part.startsWith('--inspect'))
		.join(' ')
		.trim()
	return sanitized.length > 0 ? sanitized : undefined
}

const parseCsvList = (value: string | undefined): string[] => {
	if (!value) return []
	return value
		.split(',')
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
}

export const devLocalCmd = new Command('dev-local')
	.description(
		'Run local development using bun only (opt-in). Uses app-level dev when in an app folder, otherwise bun turbo dev.'
	)
	.argument(
		'[args...]',
		'Arguments to pass to the dev script. May need to use -- to pass options to the dev script.'
	)
	.allowUnknownOption()
	.helpOption('--runx-help')
	.action(async (args) => {
		const cwd = process.cwd()
		const repoRoot = getRepoRoot()
		const isRepoRoot = cwd === repoRoot

		const [hasDevScript, hasWranglerJsonc] = await Promise.all([
			fs
				.readJson('./package.json')
				.then((packageJson) => packageJson.scripts?.dev !== undefined)
				.catch(() => false),
			fs.pathExists('./wrangler.jsonc'),
		])

		$.stdio = 'inherit'
		if (!isRepoRoot && (hasWranglerJsonc || hasDevScript)) {
			await $`bun run dev ${args}`
		} else {
			// In repo-root mode, args should target Turbo itself (e.g. --concurrency, --filter).
			// Also strip Node inspector flags to avoid inspector port collisions across many workers.
			// eslint-disable-next-line turbo/no-undeclared-env-vars
			const sanitizedNodeOptions = sanitizeNodeOptions(process.env.NODE_OPTIONS)
			if (sanitizedNodeOptions) {
				$.env.NODE_OPTIONS = sanitizedNodeOptions
			} else {
				delete $.env.NODE_OPTIONS
			}
			delete $.env.BUN_INSPECT
			delete $.env.BUN_INSPECT_BRK

			// eslint-disable-next-line turbo/no-undeclared-env-vars
			const includeWorkers = parseCsvList(process.env.LOCAL_DEV_INCLUDE_WORKERS)
			// eslint-disable-next-line turbo/no-undeclared-env-vars
			const excludeWorkers = parseCsvList(process.env.LOCAL_DEV_EXCLUDE_WORKERS)
			const workerFilters = [
				...includeWorkers.map((name) => `--filter=${name}`),
				...excludeWorkers.map((name) => `--filter=!${name}`),
			]

			// Use --only to avoid pulling in task dependencies like "build" for every package.
			// For local iteration this keeps memory/cpu pressure manageable.
			await $`bun turbo dev --only ${workerFilters} ${args}`
		}
	})
