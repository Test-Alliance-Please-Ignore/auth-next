import { readFileSync } from 'node:fs'

const uiConfig = readFileSync('apps/ui/wrangler.jsonc', 'utf8')
const uiMatch = uiConfig.match(/"VITE_DISCORD_CLIENT_ID"\s*:\s*"([^"]+)"/)

if (!uiMatch) {
	console.error('Missing VITE_DISCORD_CLIENT_ID in apps/ui/wrangler.jsonc')
	process.exit(1)
}

process.stdout.write(uiMatch[1])
