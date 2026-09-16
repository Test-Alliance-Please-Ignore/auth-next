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

	it.each([
		['ko', '이동하는 중…'],
		['es-MX', 'Redirigiendo…'],
	] as const)(
		'renders %s redirect copy and its accessible loading label',
		async (locale, label) => {
			await setAppLocale(locale, { persistLocal: false })

			const html = renderToStaticMarkup(
				<I18nProvider>
					<MemoryRouter>
						<LandingPage />
					</MemoryRouter>
				</I18nProvider>
			)

			expect(html).toContain(`aria-label="${label}"`)
			expect(html).toContain(`>${label}</p>`)
		}
	)
})
