import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { APP_LOCALES, DEFAULT_APP_LOCALE, getInitialAppLocale, parseAppLocale } from './locales'
import { resources } from './resources'

import type { AppLocale } from './locales'

void i18n.use(initReactI18next).init({
	resources,
	// Honor explicit locale preferences in every build. Without a saved choice,
	// development supports previews and production starts in English.
	lng: getInitialAppLocale(),
	fallbackLng: DEFAULT_APP_LOCALE,
	supportedLngs: APP_LOCALES,
	load: 'languageOnly',
	initAsync: false,
	returnNull: false,
	returnEmptyString: false,
	interpolation: {
		escapeValue: false,
	},
})

export { i18n }

export function getActiveLocale(): AppLocale {
	return parseAppLocale(i18n.resolvedLanguage ?? i18n.language) ?? DEFAULT_APP_LOCALE
}
