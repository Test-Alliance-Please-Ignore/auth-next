import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PlopTypes } from '@turbo/gen'

export interface UpdateWorkerIndexData {
	workerName: string
	className: string
	fileName: string
	turbo: {
		paths: {
			root: string
		}
	}
}

/**
 * Custom action to update index.ts with DO export
 */
export async function updateWorkerIndex(
	answers: UpdateWorkerIndexData
): Promise<string> {
	const indexPath = join(
		answers.turbo.paths.root,
		'apps',
		answers.workerName,
		'src',
		'index.ts'
	)

	try {
		let content = readFileSync(indexPath, 'utf-8')

		// Check if export already exists
		const exportStatement = `export { ${answers.className} } from './${answers.fileName}'`

		if (content.includes(exportStatement)) {
			return `Export ${answers.className} already exists in index.ts`
		}

		// Check if there's already a DO export comment
		if (content.includes('// Export Durable Object')) {
			// Add after the existing DO export comment
			content = content.replace(
				/(\/\/ Export Durable Object[s]?\n(?:export \{ \w+ \} from '\.\/[\w-]+'\n)*)/,
				`$1${exportStatement}\n`
			)
		} else {
			// Add at the end with a new comment
			content += `\n// Export Durable Object\n${exportStatement}\n`
		}

		writeFileSync(indexPath, content)

		return `Updated ${indexPath} with DO export ${answers.className}`
	} catch (error) {
		throw new Error(
			`Failed to update index.ts: ${error instanceof Error ? error.message : String(error)}`
		)
	}
}

export const updateWorkerIndexAction: PlopTypes.CustomActionFunction = async (
	answers
) => {
	return updateWorkerIndex(answers as UpdateWorkerIndexData)
}
