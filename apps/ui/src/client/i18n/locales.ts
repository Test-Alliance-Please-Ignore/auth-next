import {
	DEFAULT_APP_LOCALE,
	getCookieLocale,
	getStoredLocale,
	parseAppLocale,
} from '@/lib/locale-preference'

import type { AppLocale } from '@/lib/locale-preference'

export {
	APP_LOCALES,
	DEFAULT_APP_LOCALE,
	LOCALE_STORAGE_KEY,
	getCookieLocale,
	getBrowserLanguages,
	getStoredLocale,
	localeNativeNames,
	parseAppLocale,
	parseBrowserLocale,
	resolveAppLocale,
	resolveStartupLocale,
	type AppLocale,
	type LocaleResolutionInput,
} from '@/lib/locale-preference'

export const DEVELOPMENT_PREVIEW_STORAGE_KEY = 'tang.i18n.preview'

export interface InitialAppLocaleInput {
	isDevelopment: boolean
	queryLocale?: unknown
	storedPreviewLocale?: unknown
}

/**
 * Resolves development-only URL and saved preview overrides. Production
 * startup uses explicit locale preferences in getInitialAppLocale instead.
 */
export function resolveInitialAppLocale({
	isDevelopment,
	queryLocale,
	storedPreviewLocale,
}: InitialAppLocaleInput): AppLocale {
	if (!isDevelopment) {
		return DEFAULT_APP_LOCALE
	}

	return parseAppLocale(queryLocale) ?? parseAppLocale(storedPreviewLocale) ?? DEFAULT_APP_LOCALE
}

/**
 * Explicit localStorage or login-cookie choices take precedence in every build.
 * Without a saved choice, development supports locale previews and production
 * starts in English without browser-language detection.
 */
export function getInitialAppLocale(isDevelopment = import.meta.env.DEV): AppLocale {
	const preferredLocale = getStoredLocale() ?? getCookieLocale()
	if (preferredLocale) {
		return preferredLocale
	}

	if (!isDevelopment || typeof window === 'undefined') {
		return DEFAULT_APP_LOCALE
	}

	const queryLocale = new URL(window.location.href).searchParams.get('i18n')
	const parsedQueryLocale = parseAppLocale(queryLocale)
	let storedPreviewLocale: string | null = null

	try {
		storedPreviewLocale = window.localStorage.getItem(DEVELOPMENT_PREVIEW_STORAGE_KEY)
		if (parsedQueryLocale) {
			window.localStorage.setItem(DEVELOPMENT_PREVIEW_STORAGE_KEY, parsedQueryLocale)
		}
	} catch {
		// Development previewing must still work when storage is unavailable.
	}

	return resolveInitialAppLocale({
		isDevelopment,
		queryLocale,
		storedPreviewLocale,
	})
}
