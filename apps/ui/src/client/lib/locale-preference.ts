import { USER_LOCALES } from '@repo/core'

import type { UserLocale } from '@repo/core'

export const APP_LOCALES = USER_LOCALES
export type AppLocale = UserLocale

export const DEFAULT_APP_LOCALE: AppLocale = 'en'
export const LOCALE_STORAGE_KEY = 'tang.locale'

export const localeNativeNames: Record<AppLocale, string> = {
	en: 'English',
	de: 'Deutsch',
	ko: '한국어',
	'es-MX': 'Español',
}

export function parseAppLocale(value: unknown): AppLocale | null {
	if (typeof value !== 'string') {
		return null
	}

	const normalized = value.trim().toLowerCase()
	return APP_LOCALES.find((locale) => locale.toLowerCase() === normalized) ?? null
}

/** Browser language tags may include a region; saved choices use exact app codes. */
export function parseBrowserLocale(value: unknown): AppLocale | null {
	if (typeof value !== 'string' || value.trim() === '') {
		return null
	}

	try {
		const language = new Intl.Locale(value.trim()).language
		return language === 'es' ? 'es-MX' : parseAppLocale(language)
	} catch {
		return null
	}
}

export interface LocaleResolutionInput {
	localLocale?: unknown
	browserLanguages?: readonly string[] | null
}

/** Locale belongs to this browser, not an authenticated account or database row. */
export function resolveAppLocale({
	localLocale,
	browserLanguages,
}: LocaleResolutionInput): AppLocale {
	return (
		parseAppLocale(localLocale) ??
		browserLanguages
			?.map(parseBrowserLocale)
			.find((locale): locale is AppLocale => locale !== null) ??
		DEFAULT_APP_LOCALE
	)
}

export function getStoredLocale(): AppLocale | null {
	if (typeof window === 'undefined') {
		return null
	}

	try {
		return parseAppLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY))
	} catch {
		return null
	}
}

export function getCookieLocale(): AppLocale | null {
	if (typeof document === 'undefined') {
		return null
	}

	try {
		const cookie = document.cookie
			.split(';')
			.map((entry) => entry.trim())
			.find((entry) => entry.startsWith(`${LOCALE_STORAGE_KEY}=`))
		if (!cookie) return null

		return parseAppLocale(decodeURIComponent(cookie.slice(LOCALE_STORAGE_KEY.length + 1)))
	} catch {
		return null
	}
}

export function persistAppLocale(locale: AppLocale): void {
	if (typeof window === 'undefined') {
		return
	}

	try {
		window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
	} catch {
		// Privacy settings or a full storage quota must not prevent an in-memory
		// language change for the current visit.
	}
}

export function getBrowserLanguages(): readonly string[] {
	if (typeof navigator === 'undefined') {
		return []
	}

	return navigator.languages?.length ? navigator.languages : [navigator.language]
}

export function resolveStartupLocale(): AppLocale {
	return resolveAppLocale({
		localLocale: getStoredLocale() ?? getCookieLocale(),
		browserLanguages: getBrowserLanguages(),
	})
}
