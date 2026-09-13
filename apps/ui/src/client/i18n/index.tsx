import { useCallback } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'

import { persistAppLocale } from '@/lib/locale-preference'

import { getActiveLocale, i18n } from './instance'
import { DEFAULT_APP_LOCALE, parseAppLocale } from './locales'

import type { PropsWithChildren } from 'react'
import type { AppLocale } from './locales'
import type { AppTranslationKey } from './resources'

export type AppTranslator = (key: AppTranslationKey, values?: Record<string, unknown>) => string

function applyDocumentLocale(locale: AppLocale): void {
	if (typeof document === 'undefined') {
		return
	}

	document.documentElement.lang = locale
	document.documentElement.dir = 'ltr'
}

applyDocumentLocale(DEFAULT_APP_LOCALE)

export { getActiveLocale, i18n }
export {
	APP_LOCALES,
	DEFAULT_APP_LOCALE,
	LOCALE_STORAGE_KEY,
	getBrowserLanguages,
	getStoredLocale,
	localeNativeNames,
	parseAppLocale,
	parseBrowserLocale,
	resolveAppLocale,
	resolveStartupLocale,
	type AppLocale,
} from './locales'
export { resources, type AppTranslationKey } from './resources'
export {
	compareLocaleStrings,
	formatDate,
	formatDateTime,
	formatList,
	formatNumber,
	formatRelativeTime,
	getDateInputFormat,
} from './formatters'

export function I18nProvider({ children }: PropsWithChildren) {
	return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}

export async function setAppLocale(
	locale: AppLocale,
	options: { persistLocal?: boolean } = {}
): Promise<void> {
	if (options.persistLocal !== false) {
		persistAppLocale(locale)
	}

	applyDocumentLocale(locale)
	await i18n.changeLanguage(locale)
}

export function useAppTranslation() {
	const { i18n: instance, t: translate } = useTranslation()
	const locale =
		parseAppLocale(instance.resolvedLanguage ?? instance.language) ?? DEFAULT_APP_LOCALE
	const t = useCallback<AppTranslator>(
		(key: AppTranslationKey, values?: Record<string, unknown>): string =>
			String(translate(key as never, values as never)),
		[translate]
	)

	return {
		locale,
		t,
	}
}
