import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	getStoredLocale,
	LOCALE_STORAGE_KEY,
	parseAppLocale,
	parseBrowserLocale,
	persistAppLocale,
	resolveAppLocale,
	resolveStartupLocale,
} from '@/lib/locale-preference'

describe('browser-only locale preference', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('parses saved choices strictly while accepting browser language tags', () => {
		expect(parseAppLocale(' de ')).toBe('de')
		expect(parseAppLocale('de-DE')).toBeNull()
		expect(parseAppLocale('unknown')).toBeNull()
		expect(parseAppLocale(null)).toBeNull()
		expect(parseBrowserLocale('ko-KR')).toBe('ko')
		expect(parseBrowserLocale('en-Latn-US')).toBe('en')
		expect(parseBrowserLocale('de_DE')).toBeNull()
	})

	it('prefers local storage, then browser language, then English', () => {
		expect(resolveAppLocale({ localLocale: 'de', browserLanguages: ['ko-KR'] })).toBe('de')
		expect(resolveAppLocale({ browserLanguages: ['fr-FR', 'ko-KR'] })).toBe('ko')
		expect(resolveAppLocale({ localLocale: 'ko-KR', browserLanguages: ['fr-FR'] })).toBe('en')
		expect(resolveAppLocale({})).toBe('en')
	})

	it('persists a choice across fresh startup resolution without a network request', () => {
		const values = new Map<string, string>()
		const fetch = vi.fn()
		vi.stubGlobal('fetch', fetch)
		vi.stubGlobal('window', {
			localStorage: {
				getItem: (key: string) => values.get(key) ?? null,
				setItem: (key: string, value: string) => values.set(key, value),
			},
		})
		vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' })

		persistAppLocale('ko')

		expect(values.get(LOCALE_STORAGE_KEY)).toBe('ko')
		expect(getStoredLocale()).toBe('ko')
		expect(resolveStartupLocale()).toBe('ko')
		vi.stubGlobal('navigator', { languages: ['de-DE'], language: 'de-DE' })
		expect(resolveStartupLocale()).toBe('ko')
		expect(fetch).not.toHaveBeenCalled()
	})

	it('does not copy a detected browser language into explicit storage', () => {
		const setItem = vi.fn()
		vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem } })
		vi.stubGlobal('navigator', { languages: [], language: 'de-DE' })

		expect(resolveStartupLocale()).toBe('de')
		expect(setItem).not.toHaveBeenCalled()
	})

	it('ignores invalid stored values and uses browser language', () => {
		vi.stubGlobal('window', { localStorage: { getItem: () => 'de-DE' } })
		vi.stubGlobal('navigator', { languages: ['ko-KR'], language: 'ko-KR' })

		expect(getStoredLocale()).toBeNull()
		expect(resolveStartupLocale()).toBe('ko')
	})

	it('handles storage access being denied', () => {
		vi.stubGlobal('window', {
			get localStorage() {
				throw new Error('storage denied')
			},
		})
		vi.stubGlobal('navigator', { languages: ['de-DE'], language: 'de-DE' })

		expect(() => persistAppLocale('ko')).not.toThrow()
		expect(getStoredLocale()).toBeNull()
		expect(resolveStartupLocale()).toBe('de')
	})

	it('handles storage reads and writes throwing', () => {
		vi.stubGlobal('window', {
			localStorage: {
				getItem: () => {
					throw new Error('storage denied')
				},
				setItem: () => {
					throw new Error('quota exceeded')
				},
			},
		})

		expect(() => persistAppLocale('ko')).not.toThrow()
		expect(getStoredLocale()).toBeNull()
	})

	it('is safe without browser globals', () => {
		vi.stubGlobal('window', undefined)
		vi.stubGlobal('navigator', undefined)

		expect(() => persistAppLocale('ko')).not.toThrow()
		expect(getStoredLocale()).toBeNull()
		expect(resolveStartupLocale()).toBe('en')
	})
})
