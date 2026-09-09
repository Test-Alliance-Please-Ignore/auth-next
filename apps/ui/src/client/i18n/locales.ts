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
}

export function parseAppLocale(value: unknown): AppLocale | null {
	if (typeof value !== 'string') {
		return null
	}

	const normalized = value.trim().toLowerCase()
	return APP_LOCALES.find((locale) => locale === normalized) ?? null
}

/**
 * Browser locale tags include a region (for example, `de-DE`). Stored values
 * are deliberately stricter and must use one of the application locale codes.
 */
export function parseBrowserLocale(value: unknown): AppLocale | null {
	if (typeof value !== 'string' || value.trim() === '') {
		return null
	}

	try {
		return parseAppLocale(new Intl.Locale(value.trim()).language)
	} catch {
		return null
	}
}

export interface LocaleResolutionInput {
	accountLocale?: unknown
	localLocale?: unknown
	browserLanguages?: readonly string[] | null
}

export function resolveAppLocale({
	accountLocale,
	localLocale,
	browserLanguages,
}: LocaleResolutionInput): AppLocale {
	return (
		parseAppLocale(accountLocale) ??
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

export function getBrowserLanguages(): readonly string[] {
	if (typeof navigator === 'undefined') {
		return []
	}

	return navigator.languages?.length ? navigator.languages : [navigator.language]
}

export function resolveStartupLocale(accountLocale?: unknown): AppLocale {
	return resolveAppLocale({
		accountLocale,
		localLocale: getStoredLocale(),
		browserLanguages: getBrowserLanguages(),
	})
}
