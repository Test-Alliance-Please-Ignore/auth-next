import { readFileSync } from 'node:fs'

const discordConfig = readFileSync('apps/discord/wrangler.jsonc', 'utf8')
const uiConfig = readFileSync('apps/ui/wrangler.jsonc', 'utf8')

const discordMatch = discordConfig.match(/"DISCORD_CLIENT_ID"\s*:\s*"([^"]+)"/)
const uiMatch = uiConfig.match(/"VITE_DISCORD_CLIENT_ID"\s*:\s*"([^"]+)"/)

if (!discordMatch) {
	console.error('Missing DISCORD_CLIENT_ID in apps/discord/wrangler.jsonc')
	process.exit(1)
}

if (!uiMatch) {
	console.error('Missing VITE_DISCORD_CLIENT_ID in apps/ui/wrangler.jsonc')
	process.exit(1)
}

if (discordMatch[1] !== uiMatch[1]) {
	console.error(`Discord client ID mismatch: discord=${discordMatch[1]} ui=${uiMatch[1]}`)
	process.exit(1)
}
