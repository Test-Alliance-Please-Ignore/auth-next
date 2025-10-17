import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PlopTypes } from '@turbo/gen'

export interface UpdateWranglerConfigData {
	workerName: string
	className: string
	createNewWorker: boolean
	turbo: {
		paths: {
			root: string
		}
	}
}

export interface CrossWorkerBindingData extends UpdateWranglerConfigData {
	targetWorkers: string[]
	bindingName: string
	scriptName: string
}

/**
 * Custom action to update wrangler.jsonc with DO bindings and migrations
 */
export async function updateWranglerConfig(answers: UpdateWranglerConfigData): Promise<string> {
	const wranglerPath = join(answers.turbo.paths.root, 'apps', answers.workerName, 'wrangler.jsonc')

	try {
		let content = readFileSync(wranglerPath, 'utf-8')

		// Parse JSONC (strip comments for parsing)
		const jsonStr = content
			.split('\n')
			.map((line) => {
				// Remove line comments but keep the line for position tracking
				const commentIndex = line.indexOf('//')
				if (commentIndex >= 0) {
					return line.substring(0, commentIndex)
				}
				return line
			})
			.join('\n')

		const config = JSON.parse(jsonStr)

		// Initialize durable_objects if not exists
		if (!config.durable_objects) {
			config.durable_objects = { bindings: [] }
		}
		if (!config.durable_objects.bindings) {
			config.durable_objects.bindings = []
		}

		// Check if binding already exists
		const bindingExists = config.durable_objects.bindings.some(
			(binding: { name: string }) => binding.name === answers.className.toUpperCase()
		)

		if (!bindingExists) {
			// Add new binding
			config.durable_objects.bindings.push({
				name: answers.className.toUpperCase().replace(/-/g, '_') + '_STORE',
				class_name: answers.className,
			})
		}

		// Initialize migrations if not exists
		if (!config.migrations) {
			config.migrations = []
		}

		// Find the highest migration tag number
		let maxTag = 0
		for (const migration of config.migrations) {
			const match = migration.tag.match(/v(\d+)/)
			if (match) {
				maxTag = Math.max(maxTag, Number.parseInt(match[1], 10))
			}
		}

		// Add new migration
		const newTag = `v${maxTag + 1}`
		config.migrations.push({
			tag: newTag,
			new_sqlite_classes: [answers.className],
		})

		// Write back with formatting
		const newContent = JSON.stringify(config, null, '\t')
		writeFileSync(wranglerPath, newContent)

		return `Updated ${wranglerPath} with DO binding and migration`
	} catch (error) {
		throw new Error(
			`Failed to update wrangler.jsonc: ${error instanceof Error ? error.message : String(error)}`
		)
	}
}

/**
 * Custom action to add cross-worker DO bindings to other workers
 */
export async function addCrossWorkerBindings(answers: CrossWorkerBindingData): Promise<string> {
	const results: string[] = []

	for (const targetWorker of answers.targetWorkers) {
		// Skip the source worker
		if (targetWorker === answers.workerName) {
			continue
		}

		const wranglerPath = join(answers.turbo.paths.root, 'apps', targetWorker, 'wrangler.jsonc')

		try {
			let content = readFileSync(wranglerPath, 'utf-8')

			// Parse JSONC
			const jsonStr = content
				.split('\n')
				.map((line) => {
					const commentIndex = line.indexOf('//')
					if (commentIndex >= 0) {
						return line.substring(0, commentIndex)
					}
					return line
				})
				.join('\n')

			const config = JSON.parse(jsonStr)

			// Initialize durable_objects if not exists
			if (!config.durable_objects) {
				config.durable_objects = { bindings: [] }
			}
			if (!config.durable_objects.bindings) {
				config.durable_objects.bindings = []
			}

			// Check if binding already exists
			const bindingExists = config.durable_objects.bindings.some(
				(binding: { name: string }) => binding.name === answers.bindingName
			)

			if (!bindingExists) {
				// Add cross-worker binding
				config.durable_objects.bindings.push({
					name: answers.bindingName,
					class_name: answers.className,
					script_name: answers.scriptName,
				})

				// Write back with formatting
				const newContent = JSON.stringify(config, null, '\t')
				writeFileSync(wranglerPath, newContent)

				results.push(`Added binding to ${targetWorker}`)
			}
		} catch (error) {
			results.push(
				`Failed to update ${targetWorker}: ${error instanceof Error ? error.message : String(error)}`
			)
		}
	}

	return results.length > 0 ? results.join(', ') : 'No cross-worker bindings added'
}

export const updateWranglerConfigAction: PlopTypes.CustomActionFunction = async (answers) => {
	return updateWranglerConfig(answers as UpdateWranglerConfigData)
}

export const addCrossWorkerBindingsAction: PlopTypes.CustomActionFunction = async (answers) => {
	return addCrossWorkerBindings(answers as CrossWorkerBindingData)
}
