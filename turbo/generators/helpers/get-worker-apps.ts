import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Get list of worker app names from apps/ directory
 */
export function getWorkerApps(rootPath: string): string[] {
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
