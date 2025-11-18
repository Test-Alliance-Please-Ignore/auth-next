import { existsSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

type AuxiliaryWorkerConfig = {
	configPath: string
}

const currentDir = dirname(fileURLToPath(import.meta.url))
const appsDir = resolve(currentDir, '..')
const currentWranglerConfig = resolve(currentDir, 'wrangler.jsonc')

const findAuxiliaryWorkers = (): AuxiliaryWorkerConfig[] => {
	const entries = readdirSync(appsDir, { withFileTypes: true })

	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => resolve(appsDir, entry.name, 'wrangler.jsonc'))
		.filter((configPath) => configPath !== currentWranglerConfig && existsSync(configPath))
		.sort()
		.map((configPath) => {
			const relativePath = relative(currentDir, configPath)
			return {
				configPath: relativePath.startsWith('.') ? relativePath : `./${relativePath}`,
			}
		})
}

export default defineConfig({
	plugins: [
		cloudflare({
			auxiliaryWorkers: findAuxiliaryWorkers(),
		}),
	],
})
