/**
 * UI Worker - Serves React SPA via Cloudflare Workers Static Assets
 */

export default {
	async fetch(request: Request, env: any): Promise<Response> {
		// Serve static assets using the ASSETS binding
		// The ASSETS binding is configured in wrangler.jsonc
		return env.ASSETS.fetch(request)
	},
}
