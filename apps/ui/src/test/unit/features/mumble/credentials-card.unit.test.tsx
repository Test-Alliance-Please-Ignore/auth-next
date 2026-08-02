import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { OneTimeCredentialsCard } from '@/features/mumble/components/credentials-card'

describe('OneTimeCredentialsCard', () => {
	it('renders copyable connection fields in Mumble form order', () => {
		const html = renderToStaticMarkup(
			<OneTimeCredentialsCard
				credentials={{
					loginName: 'Pilot One',
					password: 'secret',
					connection: { host: 'voice.example.test', port: 64738 },
				}}
			/>
		)

		const usernameIndex = html.indexOf('Pilot One')
		const passwordIndex = html.indexOf('secret')
		const serverIndex = html.indexOf('voice.example.test')
		const portIndex = html.indexOf('64738')

		expect(usernameIndex).toBeGreaterThan(-1)
		expect(passwordIndex).toBeGreaterThan(usernameIndex)
		expect(serverIndex).toBeGreaterThan(passwordIndex)
		expect(portIndex).toBeGreaterThan(serverIndex)
	})
})
