import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PlopTypes } from '@turbo/gen'

export interface UpdateWorkerContextData {
	workerName: string
	bindingName: string
	turbo: {
		paths: {
			root: string
		}
	}
}

/**
 * Custom action to update context.ts with DO namespace binding
 */
export async function updateWorkerContext(
	answers: UpdateWorkerContextData
): Promise<string> {
	const contextPath = join(
		answers.turbo.paths.root,
		'apps',
		answers.workerName,
		'src',
		'context.ts'
	)

	try {
		let content = readFileSync(contextPath, 'utf-8')

		// Find the Env type definition
		const envTypeRegex = /export type Env = SharedHonoEnv & \{([^}]*)\}/s
		const match = content.match(envTypeRegex)

		if (!match) {
			throw new Error('Could not find Env type definition in context.ts')
		}

		const currentEnvBody = match[1]

		// Check if binding already exists
		if (currentEnvBody.includes(answers.bindingName)) {
			return `Binding ${answers.bindingName} already exists in context.ts`
		}

		// Add new binding before the closing brace
		// Find the last property in the Env type
		const lines = currentEnvBody.split('\n')
		const lastPropertyIndex = lines.findLastIndex((line) => line.trim() && line.includes(':'))

		if (lastPropertyIndex === -1) {
			// No properties yet, add as first property
			const newBinding = `\t${answers.bindingName}: DurableObjectNamespace`
			const newEnvBody = `${newBinding}\n`
			content = content.replace(envTypeRegex, `export type Env = SharedHonoEnv & {\n${newEnvBody}}`)
		} else {
			// Insert after last property
			lines.splice(lastPropertyIndex + 1, 0, `\t${answers.bindingName}: DurableObjectNamespace`)
			const newEnvBody = lines.join('\n')
			content = content.replace(envTypeRegex, `export type Env = SharedHonoEnv & {${newEnvBody}}`)
		}

		writeFileSync(contextPath, content)

		return `Updated ${contextPath} with DO binding ${answers.bindingName}`
	} catch (error) {
		throw new Error(
			`Failed to update context.ts: ${error instanceof Error ? error.message : String(error)}`
		)
	}
}

export const updateWorkerContextAction: PlopTypes.CustomActionFunction = async (
	answers
) => {
	return updateWorkerContext(answers as UpdateWorkerContextData)
}
