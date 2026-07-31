import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// This package's sources import `cloudflare:workflows` / `cloudflare:workers`, which only
// resolve inside the workers runtime — plain node vitest cannot collect these suites.
export default defineConfig({
	plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
	test: { globals: true },
})
