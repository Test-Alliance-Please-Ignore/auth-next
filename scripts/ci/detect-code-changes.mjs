import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

/**
 * Decide whether a PR or push touched anything that needs check/test/deploy.
 *
 * Shared by both CI workflows so the ignore list lives in exactly one place:
 *  - branches.yml (pull_request / merge_group) — gates the "Check" job
 *  - release.yml  (push to main)               — gates test-and-deploy
 *
 * Writes `code=true|false` to $GITHUB_OUTPUT.
 *
 * FAIL-SAFE: any ambiguity (no file list, API error, truncated diff) resolves to
 * `code=true`. Running checks we didn't strictly need is cheap; silently skipping
 * CI on a real code change is not.
 */

// Paths that never affect a built or deployed worker. A change confined to these
// skips the pipeline; a mixed doc+code change still runs.
const IGNORE_PATTERNS = [
	/\.md$/,
	/^docs\//,
	/^\.changeset\//,
	/^\.github\//, // workflows, issue templates, CODEOWNERS — not app code
	/^\.vscode\//,
	/^\.cursor\//,
	/^\.claude\//,
	/^\.editorconfig$/,
]

const ZERO_SHA = '0000000000000000000000000000000000000000'

/** Run `gh api`, paginating, and return one filename per line. */
function ghApiFilenames(path, jqFilter) {
	const out = execFileSync('gh', ['api', '--paginate', path, '--jq', jqFilter], {
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
	})
	return out.split('\n').filter(Boolean)
}

/**
 * @returns {string[] | null} changed filenames, or null when the file set can't be
 * determined reliably (caller then fails safe to running everything).
 */
function listChangedFiles() {
	const { REPO, PR, BEFORE, AFTER } = process.env

	// pull_request event: GitHub knows the PR's exact file set.
	if (PR) {
		return ghApiFilenames(`repos/${REPO}/pulls/${PR}/files`, '.[].filename')
	}

	// push event: compare the pushed range. The compare API needs no local git
	// history, so it works with the default shallow checkout (fetch-depth: 1).
	if (BEFORE && AFTER && BEFORE !== ZERO_SHA) {
		return ghApiFilenames(`repos/${REPO}/compare/${BEFORE}...${AFTER}`, '.files[].filename')
	}

	// merge_group, first push to a branch (before = zeros), or missing inputs:
	// no dependable file list, so run the full pipeline.
	return null
}

function main() {
	const output = process.env.GITHUB_OUTPUT
	let code = true // fail-safe default

	try {
		const files = listChangedFiles()
		if (files === null) {
			console.log('No reliable changed-file list — running full checks.')
		} else {
			const changedCode = files.filter((f) => !IGNORE_PATTERNS.some((re) => re.test(f)))
			if (changedCode.length > 0) {
				console.log(`Code changed (${changedCode.length} file(s)) — running checks.`)
				code = true
			} else {
				console.log('Only docs/config changed — skipping checks.')
				code = false
			}
		}
	} catch (err) {
		console.error(`Change detection failed, running full checks to be safe: ${err.message}`)
		code = true
	}

	if (output) {
		appendFileSync(output, `code=${code}\n`)
	} else {
		// Local invocation: print the decision so the script is runnable by hand.
		console.log(`code=${code}`)
	}
}

main()
