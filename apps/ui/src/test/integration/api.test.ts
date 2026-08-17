import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('serves the SPA entrypoint', async () => {
	const res = await SELF.fetch('https://example.com')
	expect(res.status).toBe(200)
	expect(await res.text()).toContain('<title>Test Auth</title>')
})
