import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Get list of worker app names from apps/ directory
 * Only returns workers that have the essential files (wrangler.jsonc, package.json)
 */
export function getWorkerApps(rootPath: string): string[] {
	const appsPath = join(rootPath, 'apps')

	try {
		const entries = readdirSync(appsPath)
		return entries.filter((entry) => {
			const fullPath = join(appsPath, entry)
			if (!statSync(fullPath).isDirectory()) {
				return false
			}

			// Validate that essential worker files exist
			const hasWrangler = existsSync(join(fullPath, 'wrangler.jsonc'))
			const hasPackageJson = existsSync(join(fullPath, 'package.json'))
			const hasSrc = existsSync(join(fullPath, 'src'))

			return hasWrangler && hasPackageJson && hasSrc
		})
	} catch {
		return []
	}
}

/**
 * Get all directories in apps/, including incomplete workers
 * Useful for detecting incomplete worker setups
 */
export function getAllAppDirectories(rootPath: string): string[] {
	const appsPath = join(rootPath, 'apps')

	try {
		const entries = readdirSync(appsPath)
		return entries.filter((entry) => {
			const fullPath = join(appsPath, entry)
			return statSync(fullPath).isDirectory()
		})
	} catch {
		return []
	}
}
