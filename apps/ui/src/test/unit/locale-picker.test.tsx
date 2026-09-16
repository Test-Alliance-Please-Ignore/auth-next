import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LocalePicker } from '@/components/locale-picker'
import { getActiveLocale, getInitialAppLocale, I18nProvider, setAppLocale } from '@/i18n'

import type { SelectOption, SelectProps } from '@/components/ui/select'

const state = vi.hoisted(() => ({ select: null as SelectProps<SelectOption> | null }))

vi.mock('@/components/ui/select', () => ({
	Select: (props: SelectProps<SelectOption>) => {
		state.select = props
		return (
			<button id={props.inputId}>
				{props.options.find(({ value }) => value === props.value)?.label}
			</button>
		)
	},
}))

describe('locale picker', () => {
	afterEach(async () => {
		vi.unstubAllGlobals()
		await setAppLocale('en', { persistLocal: false })
	})

	it.each([false, true])(
		'selects Español and restores Mexican Spanish after reload (development: %s)',
		async (isDevelopment) => {
			const values = new Map<string, string>()
			vi.stubGlobal('window', {
				location: { href: 'https://example.test/dashboard?i18n=ko' },
				localStorage: {
					getItem: (key: string) => values.get(key) ?? null,
					setItem: (key: string, value: string) => values.set(key, value),
				},
			})
			vi.stubGlobal('document', {
				cookie: 'tang.locale=de',
				documentElement: { lang: 'en', dir: 'ltr' },
			})
			const render = () =>
				renderToStaticMarkup(
					<I18nProvider>
						<LocalePicker />
					</I18nProvider>
				)
			render()
			const spanish = state.select?.options.find(({ value }) => value === 'es-MX')
			expect(state.select?.options).toHaveLength(4)
			expect(spanish).toEqual({ value: 'es-MX', label: 'Español' })
			state.select?.onValueChange?.('es-MX', spanish ?? null)
			await vi.waitFor(() => expect(getActiveLocale()).toBe('es-MX'))

			const html = render()
			expect(html).toContain('>Idioma</label>')
			expect(html).toContain('>Español</button>')
			expect(html).toContain(`for="${state.select?.inputId}"`)
			expect(document.documentElement.lang).toBe('es-MX')
			expect(document.documentElement.dir).toBe('ltr')
			expect(values.get('tang.locale')).toBe('es-MX')
			expect(getInitialAppLocale(isDevelopment)).toBe('es-MX')
		}
	)
})
