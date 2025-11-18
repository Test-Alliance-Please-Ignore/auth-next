import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { parse as parseJsonc } from 'jsonc-parser'
import { defineConfig } from 'vite'

type AuxiliaryWorkerConfig = {
	configPath: string
}

type WranglerConfig = {
	durable_objects?: {
		bindings?: Array<{
			script_name?: string
		}>
	}
	services?: Array<{
		service?: string
	}>
}

const currentDir = dirname(fileURLToPath(import.meta.url))
const currentWranglerConfig = resolve(currentDir, 'wrangler.jsonc')
const appsDir = resolve(currentDir, '..')

/**
 * Extracts auxiliary worker names from a parsed WranglerConfig
 */
const extractWorkerNamesFromConfig = (config: WranglerConfig): Set<string> => {
	const workerNames = new Set<string>()

	// Extract worker names from durable_objects.bindings
	if (config.durable_objects?.bindings) {
		for (const binding of config.durable_objects.bindings) {
			if (binding.script_name) {
				workerNames.add(binding.script_name)
			}
		}
	}

	// Extract worker names from services
	if (config.services) {
		for (const service of config.services) {
			if (service.service) {
				workerNames.add(service.service)
			}
		}
	}

	return workerNames
}

const findAuxiliaryWorkers = (): AuxiliaryWorkerConfig[] => {
	if (!existsSync(currentWranglerConfig)) {
		return []
	}

	// Set to track all discovered workers (prevents duplicates and infinite loops)
	const discoveredWorkers = new Set<string>()

	// Queue of workers to process
	const workersToProcess: string[] = []

	// Start with the current worker's config
	const initialConfigContent = readFileSync(currentWranglerConfig, 'utf-8')
	const initialConfig = parseJsonc(initialConfigContent) as WranglerConfig
	const initialWorkers = extractWorkerNamesFromConfig(initialConfig)

	// Add initial workers to discovered set and queue
	for (const workerName of initialWorkers) {
		discoveredWorkers.add(workerName)
		workersToProcess.push(workerName)
	}

	// Recursively process workers
	while (workersToProcess.length > 0) {
		const workerName = workersToProcess.shift()!
		const workerConfigPath = resolve(appsDir, workerName, 'wrangler.jsonc')

		// Skip if config doesn't exist
		if (!existsSync(workerConfigPath)) {
			continue
		}

		// Read and parse the worker's config
		const workerConfigContent = readFileSync(workerConfigPath, 'utf-8')
		const workerConfig = parseJsonc(workerConfigContent) as WranglerConfig
		const workerAuxiliaries = extractWorkerNamesFromConfig(workerConfig)

		// Add new workers to discovered set and queue
		for (const auxiliaryWorker of workerAuxiliaries) {
			if (!discoveredWorkers.has(auxiliaryWorker)) {
				discoveredWorkers.add(auxiliaryWorker)
				workersToProcess.push(auxiliaryWorker)
			}
		}
	}

	// Map worker names to config paths
	return Array.from(discoveredWorkers)
		.sort()
		.map((workerName) => {
			const configPath = resolve(appsDir, workerName, 'wrangler.jsonc')
			return configPath
		})
		.filter((configPath) => existsSync(configPath))
		.map((configPath) => {
			const relativePath = relative(currentDir, configPath)
			return {
				configPath: relativePath.startsWith('.') ? relativePath : `./${relativePath}`,
			}
		})
}

console.log(findAuxiliaryWorkers())

export default defineConfig({
	plugins: [
		cloudflare({
			configPath: currentWranglerConfig,
			auxiliaryWorkers: [
				{ configPath: '../eve-token-store/wrangler.jsonc' },
				{ configPath: '../eve-corporation-data/wrangler.jsonc' },
				{ configPath: '../universe/wrangler.jsonc' },
			],
		}),
	],
})
