import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	formatDate,
	formatList,
	formatNumber,
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
import { de, en, ko } from '@/i18n/resources'

import type { AppTranslationKey } from '@/i18n'

function keyShape(value: unknown): unknown {
	if (typeof value === 'string') {
		return 'message'
	}

	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, keyShape(entry)]))
	}

	return typeof value
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

	it('keeps German and Korean catalog structures exactly aligned with English', () => {
		expect(keyShape(de)).toEqual(keyShape(en))
		expect(keyShape(ko)).toEqual(keyShape(en))
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
