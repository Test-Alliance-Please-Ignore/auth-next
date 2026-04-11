import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { renderDiscordContentValue } from '@/components/discord-content-renderer'

describe('renderDiscordContentValue security', () => {
	it('escapes HTML/script payloads instead of rendering executable tags', () => {
		const payload = 'hello <script>alert("xss")</script> world'
		const html = renderToStaticMarkup(
			<>{renderDiscordContentValue(payload, 'security-script-check')}</>
		)

		expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
		expect(html).not.toContain('<script>')
	})

	it('escapes HTML in template-like substituted values', () => {
		const payload = 'Ping: <img src=x onerror=alert(1)>'
		const html = renderToStaticMarkup(
			<>{renderDiscordContentValue(payload, 'security-template-value')}</>
		)

		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
		expect(html).not.toContain('<img')
	})
})
