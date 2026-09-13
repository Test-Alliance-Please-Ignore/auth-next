import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider, setAppLocale } from '@/i18n'
import LandingPage from '@/routes/landing'

vi.mock('@/hooks/useAuth', () => ({
	useAuth: () => ({ isAuthenticated: false, isLoading: true }),
}))

describe('localized application shell', () => {
	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
	})

	it('renders translated redirect copy and its accessible loading label', async () => {
		await setAppLocale('ko', { persistLocal: false })

		const html = renderToStaticMarkup(
			<I18nProvider>
				<MemoryRouter>
					<LandingPage />
				</MemoryRouter>
			</I18nProvider>
		)

		expect(html).toContain('aria-label="이동하는 중…"')
		expect(html).toContain('>이동하는 중…</p>')
	})
})
