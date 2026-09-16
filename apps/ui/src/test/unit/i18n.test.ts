import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	formatDate,
	formatList,
	formatNumber,
	formatRelativeTime,
	getActiveLocale,
	getDateInputFormat,
	getInitialAppLocale,
	i18n,
	parseAppLocale,
	parseBrowserLocale,
	resolveAppLocale,
	resolveInitialAppLocale,
	resolveStartupLocale,
	setAppLocale,
} from '@/i18n'
import { en, resources } from '@/i18n/resources'

import type { AppTranslationKey } from '@/i18n'

function keyShape(value: unknown, includeMany = false): unknown {
	if (typeof value === 'string') {
		return 'message'
	}

	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).flatMap(([key, entry]) => {
				const shape = keyShape(entry, includeMany)
				return includeMany && key.endsWith('_other')
					? [
							[key, shape],
							[key.replace(/_other$/, '_many'), shape],
						]
					: [[key, shape]]
			})
		)
	}

	return typeof value
}

function messageTokens(value: unknown, includeMany = false): unknown {
	if (typeof value === 'string') {
		return [...value.matchAll(/\{\{[^}]+\}\}|<\/?[a-zA-Z]+>/g)].map(([token]) => token).sort()
	}

	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
			const tokens = messageTokens(entry, includeMany)
			return includeMany && key.endsWith('_other')
				? [
						[key, tokens],
						[key.replace(/_other$/, '_many'), tokens],
					]
				: [[key, tokens]]
		})
	)
}

describe('application i18n runtime', () => {
	beforeEach(async () => {
		await setAppLocale('en', { persistLocal: false })
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('strictly parses saved locales and normalizes valid browser language tags', () => {
		expect(parseAppLocale(' de ')).toBe('de')
		expect(parseAppLocale('de-DE')).toBeNull()
		expect(parseAppLocale('unknown')).toBeNull()
		expect(parseBrowserLocale('de-DE')).toBe('de')
		expect(parseBrowserLocale('ko-KR')).toBe('ko')
		expect(parseBrowserLocale('en-Latn-US')).toBe('en')
		expect(parseBrowserLocale('de_DE')).toBeNull()
		expect(parseBrowserLocale('')).toBeNull()
	})

	it('resolves local, browser, and English fallback precedence', () => {
		expect(
			resolveAppLocale({
				localLocale: 'de',
				browserLanguages: ['en-GB'],
			})
		).toBe('de')
		expect(resolveAppLocale({ localLocale: 'de', browserLanguages: ['ko-KR'] })).toBe('de')
		expect(resolveAppLocale({ browserLanguages: ['de-DE', 'en-US'] })).toBe('de')
		expect(
			resolveAppLocale({
				localLocale: 'ko-KR',
				browserLanguages: ['fr-FR'],
			})
		).toBe('en')
	})

	it('reads the real startup inputs without loosening saved-value parsing', () => {
		vi.stubGlobal('window', {
			localStorage: { getItem: () => 'de-DE' },
		})
		vi.stubGlobal('navigator', { languages: ['ko-KR', 'de-DE'], language: 'ko-KR' })

		expect(resolveStartupLocale()).toBe('ko')
	})

	it.each([false, true])(
		'uses an explicit login cookie at startup (development: %s)',
		(isDevelopment) => {
			vi.stubGlobal('window', {
				localStorage: { getItem: () => null },
				location: { href: 'http://localhost:5173/dashboard' },
			})
			vi.stubGlobal('document', { cookie: 'tang.locale=de' })

			expect(getInitialAppLocale(isDevelopment)).toBe('de')
		}
	)

	it.each([false, true])(
		'restores a language selection ahead of cookies and previews (development: %s)',
		async (isDevelopment) => {
			const values = new Map([['tang.i18n.preview', 'ko']])
			vi.stubGlobal('window', {
				location: { href: 'http://localhost:5173/dashboard?i18n=ko' },
				localStorage: {
					getItem: (key: string) => values.get(key) ?? null,
					setItem: (key: string, value: string) => values.set(key, value),
				},
			})
			vi.stubGlobal('document', {
				cookie: 'tang.locale=ko',
				documentElement: { lang: 'en', dir: 'ltr' },
			})

			await setAppLocale('de')

			expect(getInitialAppLocale(isDevelopment)).toBe('de')
			expect(document.documentElement.lang).toBe('de')
			expect(values.get('tang.locale')).toBe('de')
		}
	)

	it('allows URL locale previews only in development builds', () => {
		expect(
			resolveInitialAppLocale({
				isDevelopment: true,
				queryLocale: 'ko',
				storedPreviewLocale: 'de',
			})
		).toBe('ko')
		expect(
			resolveInitialAppLocale({
				isDevelopment: true,
				queryLocale: 'invalid',
				storedPreviewLocale: 'de',
			})
		).toBe('de')
		expect(
			resolveInitialAppLocale({
				isDevelopment: false,
				queryLocale: 'ko',
				storedPreviewLocale: 'de',
			})
		).toBe('en')
	})

	it('persists a valid development URL preview for later navigation', () => {
		const values = new Map<string, string>()
		vi.stubGlobal('window', {
			location: { href: 'http://localhost:5173/dashboard?i18n=ko' },
			localStorage: {
				getItem: (key: string) => values.get(key) ?? null,
				setItem: (key: string, value: string) => values.set(key, value),
			},
		})

		expect(getInitialAppLocale(true)).toBe('ko')
		expect(values.get('tang.i18n.preview')).toBe('ko')
	})

	it.each(Object.entries(resources))(
		'keeps the %s catalog structure aligned with English',
		(locale, { translation }) => {
			expect(keyShape(translation)).toEqual(keyShape(en, locale === 'es-MX'))
		}
	)

	it('preserves interpolation and markup tokens throughout the Spanish catalog', () => {
		expect(messageTokens(resources['es-MX'].translation)).toEqual(messageTokens(en, true))
	})

	it('uses Mexican Spanish resources and formatting without falling back to English', async () => {
		await setAppLocale('es-MX', { persistLocal: false })
		expect(getActiveLocale()).toBe('es-MX')
		expect(i18n.resolvedLanguage).toBe('es-MX')
		expect(i18n.t('common.items', { count: 0 })).toBe('0 elementos')
		expect(i18n.t('common.items', { count: 1 })).toBe('1 elemento')
		expect(i18n.t('common.items', { count: 2 })).toBe('2 elementos')
		expect(i18n.t('common.items', { count: 1_000_000 })).toBe('1000000 elementos')
		expect(i18n.t('dashboard.portraitAlt', { name: 'Alpha Pilot' })).toBe('Retrato de Alpha Pilot')
		expect(formatNumber(1_234_567.89)).toBe('1,234,567.89')
		expect(formatDate('2026-02-03', { dateStyle: 'short' })).toBe('03/02/26')
		expect(formatList(['Alpha', 'Beta'])).toBe('Alpha y Beta')
		expect(formatRelativeTime(-1, 'day')).toBe('ayer')
		expect(getDateInputFormat()).toBe('DD/MM/YYYY')
	})

	it('normalizes plural suffixes in the typed translation key surface', () => {
		const pluralKey: AppTranslationKey = 'common.items'

		expect(pluralKey).toBe('common.items')
	})

	it('uses interpolation, plural messages, and active-locale formatters', async () => {
		await setAppLocale('de', { persistLocal: false })
		expect(i18n.t('common.items', { count: 1 })).toBe('1 Element')
		expect(i18n.t('common.items', { count: 2 })).toBe('2 Elemente')
		expect(formatNumber(1_234_567.89)).toBe('1.234.567,89')
		expect(formatDate('2026-02-03', { dateStyle: 'short' })).toBe('03.02.26')
		expect(formatList(['Alpha', 'Beta'])).toBe('Alpha und Beta')
		expect(getDateInputFormat()).toBe('DD.MM.YYYY')

		await setAppLocale('ko', { persistLocal: false })
		expect(formatNumber(1_234_567.89)).toBe('1,234,567.89')
		expect(getDateInputFormat()).toBe('YYYY. MM. DD.')
	})

	it('updates document metadata and persists an explicit selection locally', async () => {
		const values = new Map<string, string>()
		const fetch = vi.fn()
		vi.stubGlobal('fetch', fetch)
		vi.stubGlobal('window', {
			localStorage: {
				getItem: (key: string) => values.get(key) ?? null,
				setItem: (key: string, value: string) => values.set(key, value),
			},
		})
		vi.stubGlobal('document', { documentElement: { lang: 'en', dir: 'rtl' } })

		await setAppLocale('ko')

		expect(values.get('tang.locale')).toBe('ko')
		expect(resolveStartupLocale()).toBe('ko')
		expect(fetch).not.toHaveBeenCalled()
		expect(document.documentElement.lang).toBe('ko')
		expect(document.documentElement.dir).toBe('ltr')
	})

	it('can change the in-memory locale without overwriting the saved preference', async () => {
		const setItem = vi.fn()
		vi.stubGlobal('window', { localStorage: { getItem: () => 'ko', setItem } })

		await setAppLocale('de', { persistLocal: false })

		expect(i18n.resolvedLanguage).toBe('de')
		expect(resolveStartupLocale()).toBe('ko')
		expect(setItem).not.toHaveBeenCalled()
	})

	it('still applies an in-memory locale when browser storage is unavailable', async () => {
		vi.stubGlobal('window', {
			localStorage: {
				setItem: () => {
					throw new Error('storage denied')
				},
			},
		})
		vi.stubGlobal('document', { documentElement: { lang: 'en', dir: 'rtl' } })

		await expect(setAppLocale('de')).resolves.toBeUndefined()
		expect(i18n.resolvedLanguage).toBe('de')
		expect(document.documentElement.lang).toBe('de')
	})
})
