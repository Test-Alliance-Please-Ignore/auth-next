import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const expected = process.env.VITE_DISCORD_CLIENT_ID

if (!expected) {
	console.error('VITE_DISCORD_CLIENT_ID is not set in the build environment')
	process.exit(1)
}

const distDir = join('apps', 'ui', 'dist')
if (!existsSync(distDir)) {
	console.error('UI build output missing: apps/ui/dist')
	process.exit(1)
}

const files = readdirSync(distDir, { recursive: true })
const jsFiles = files
	.filter((file) => typeof file === 'string' && file.endsWith('.js'))
	.map((file) => join(distDir, file))

const found = jsFiles.some((file) => readFileSync(file, 'utf8').includes(expected))

if (!found) {
	console.error(`UI build is missing injected VITE_DISCORD_CLIENT_ID (${expected}) in dist JS assets`)
	process.exit(1)
}
