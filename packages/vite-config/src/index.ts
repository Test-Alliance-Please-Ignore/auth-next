import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { parse as parseJsonc } from 'jsonc-parser'
import type { ConfigEnv, UserConfig } from 'vite'
import { defineConfig } from 'vite'

export type AuxiliaryWorkerConfig = {
	configPath: string
}

export type WranglerConfig = {
	name?: string
	durable_objects?: {
		bindings?: Array<{
			script_name?: string
		}>
	}
	services?: Array<{
		service?: string
	}>
}

/**
 * Extracts auxiliary worker names from a parsed WranglerConfig
 */
export const extractWorkerNamesFromConfig = (config: WranglerConfig): Set<string> => {
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

/**
 * Recursively discovers auxiliary workers from wrangler.jsonc configuration
 * @param currentDir - The directory of the current worker (typically from dirname(fileURLToPath(import.meta.url)))
 * @returns Array of auxiliary worker configurations
 */
export const findAuxiliaryWorkers = (currentDir: string): AuxiliaryWorkerConfig[] => {
	const currentWranglerConfig = resolve(currentDir, 'wrangler.jsonc')
	const appsDir = resolve(currentDir, '..')

	if (!existsSync(currentWranglerConfig)) {
		return []
	}

	// Read current worker's config to get its name
	const initialConfigContent = readFileSync(currentWranglerConfig, 'utf-8')
	const initialConfig = parseJsonc(initialConfigContent) as WranglerConfig
	const currentWorkerName = initialConfig.name

	if (!currentWorkerName) {
		return []
	}

	// Set to track all discovered workers (prevents duplicates and infinite loops)
	const discoveredWorkers = new Set<string>()

	// Queue of workers to process
	const workersToProcess: string[] = []

	// Extract initial auxiliary workers (excluding the current worker itself)
	const initialWorkers = extractWorkerNamesFromConfig(initialConfig)

	// Add initial workers to discovered set and queue (excluding current worker)
	for (const workerName of initialWorkers) {
		if (workerName !== currentWorkerName) {
			discoveredWorkers.add(workerName)
			workersToProcess.push(workerName)
		}
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

		// Add new workers to discovered set and queue (excluding current worker)
		for (const auxiliaryWorker of workerAuxiliaries) {
			if (auxiliaryWorker !== currentWorkerName && !discoveredWorkers.has(auxiliaryWorker)) {
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

/**
 * Creates a Vite configuration with Cloudflare plugin and auxiliary worker discovery
 * @param currentDir - The directory of the current worker (typically from dirname(fileURLToPath(import.meta.url)))
 * @param configPath - Optional path to wrangler.jsonc (defaults to currentDir/wrangler.jsonc)
 * @returns Vite UserConfig function that conditionally uses auxiliary worker discovery in dev mode
 */
export const createViteConfig = (
	currentDir: string,
	configPath?: string,
) => {
	const wranglerConfigPath = configPath ?? resolve(currentDir, 'wrangler.jsonc')

	return defineConfig(({ command }: ConfigEnv): UserConfig => {
		// Only use auxiliary worker discovery in dev mode (serve command)
		// For builds, use simple cloudflare plugin for faster builds
		if (command === 'serve') {
			const auxiliaryWorkers = findAuxiliaryWorkers(currentDir)
			return {
				plugins: [
					cloudflare({
						configPath: wranglerConfigPath,
						auxiliaryWorkers,
					}),
				],
			}
		}

		// Build mode: simple configuration without auxiliary worker discovery
		return {
			plugins: [cloudflare({ configPath: wranglerConfigPath })],
		}
	})
}
