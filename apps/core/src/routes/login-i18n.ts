import { USER_LOCALES } from '@repo/core'

import type { UserLocale } from '@repo/core'

export const LOGIN_LOCALE_COOKIE = 'tang.locale'
export const DEFAULT_LOGIN_LOCALE: UserLocale = 'en'

const supportedLocales = new Set<string>(USER_LOCALES)

export interface LoginMessages {
	title: string
	metaTitle: string
	description: string
	welcome: string
	subtitle: string
	intro: string
	accountWarningTitle: string
	accountWarningText: string
	characterWarningTitle: string
	characterWarningBefore: string
	mainCharacter: string
	characterWarningAfter: string
	nextTitle: string
	nextSteps: readonly [string, string, string, string, string]
	securityTitle: string
	securityText: string
	continueButton: string
	cancelButton: string
	footer: string
	languageLabel: string
	applyLanguage: string
}

export const LOGIN_LOCALE_NAMES: Record<UserLocale, string> = {
	en: 'English',
	de: 'Deutsch',
	ko: '한국어',
}

export const LOGIN_MESSAGES = {
	en: {
		title: 'Login - TEST Auth',
		metaTitle: 'Login to TEST Auth',
		description: 'Secure authentication for EVE Online alliances and corporations',
		welcome: 'Welcome to TEST Auth',
		subtitle: 'Secure Authentication for EVE Online',
		intro:
			"You are about to log in using EVE Online's secure Single Sign-On (SSO) system. This ensures your credentials stay safe and are never shared with third parties.",
		accountWarningTitle: 'Important: Do Not Create a Second Account',
		accountWarningText:
			'You are about to create a new TEST Auth account. If you have created an Auth account before, do not create another one. Multiple Auth accounts cause problems later.',
		characterWarningTitle: 'Important: Select Your Main Character',
		characterWarningBefore: 'When you reach the EVE SSO page, please select your ',
		mainCharacter: 'main character',
		characterWarningAfter:
			'. This character will be associated with your account and cannot be easily changed later.',
		nextTitle: 'What happens next?',
		nextSteps: [
			"You'll be redirected to EVE Online's official login page",
			'Log in with your EVE Online account credentials',
			'Select your main character from your character list',
			'Authorize TEST Auth to access your character information',
			"You'll be automatically redirected back to continue",
		],
		securityTitle: 'Your data is secure',
		securityText:
			'We only request the necessary permissions to verify your identity and manage your group memberships. Your EVE Online password is never shared with us.',
		continueButton: 'Continue to EVE Online Login',
		cancelButton: 'Cancel',
		footer: 'Powered by EVE Online SSO • Your credentials remain secure with CCP Games',
		languageLabel: 'Language',
		applyLanguage: 'Apply',
	},
	de: {
		title: 'Anmelden - TEST Auth',
		metaTitle: 'Bei TEST Auth anmelden',
		description: 'Sichere Authentifizierung für EVE-Online-Allianzen und -Corporations',
		welcome: 'Willkommen bei TEST Auth',
		subtitle: 'Sichere Authentifizierung für EVE Online',
		intro:
			'Du meldest dich gleich über das sichere Single-Sign-On-System (SSO) von EVE Online an. Dadurch bleiben deine Zugangsdaten geschützt und werden niemals an Dritte weitergegeben.',
		accountWarningTitle: 'Wichtig: Erstelle kein zweites Konto',
		accountWarningText:
			'Du bist dabei, ein neues TEST-Auth-Konto zu erstellen. Falls du bereits ein Auth-Konto angelegt hast, erstelle bitte kein weiteres. Mehrere Auth-Konten führen später zu Problemen.',
		characterWarningTitle: 'Wichtig: Wähle deinen Hauptcharakter',
		characterWarningBefore: 'Wähle auf der EVE-SSO-Seite bitte deinen ',
		mainCharacter: 'Hauptcharakter',
		characterWarningAfter:
			'. Dieser Charakter wird deinem Konto zugeordnet und kann später nicht ohne Weiteres geändert werden.',
		nextTitle: 'Wie geht es weiter?',
		nextSteps: [
			'Du wirst zur offiziellen Anmeldeseite von EVE Online weitergeleitet',
			'Melde dich mit den Zugangsdaten deines EVE-Online-Kontos an',
			'Wähle deinen Hauptcharakter aus der Charakterliste',
			'Erlaube TEST Auth den Zugriff auf deine Charakterinformationen',
			'Du wirst anschließend automatisch zurückgeleitet',
		],
		securityTitle: 'Deine Daten sind sicher',
		securityText:
			'Wir fordern nur die Berechtigungen an, die zur Überprüfung deiner Identität und zur Verwaltung deiner Gruppenmitgliedschaften erforderlich sind. Dein EVE-Online-Passwort wird niemals an uns übermittelt.',
		continueButton: 'Weiter zur EVE-Online-Anmeldung',
		cancelButton: 'Abbrechen',
		footer:
			'Bereitgestellt mit EVE Online SSO • Deine Zugangsdaten bleiben bei CCP Games geschützt',
		languageLabel: 'Sprache',
		applyLanguage: 'Übernehmen',
	},
	ko: {
		title: '로그인 - TEST Auth',
		metaTitle: 'TEST Auth에 로그인',
		description: 'EVE Online 얼라이언스와 코퍼레이션을 위한 안전한 인증',
		welcome: 'TEST Auth에 오신 것을 환영합니다',
		subtitle: 'EVE Online을 위한 안전한 인증',
		intro:
			'EVE Online의 안전한 통합 로그인(SSO) 시스템을 사용해 로그인합니다. 계정 인증 정보는 안전하게 보호되며 제3자에게 공유되지 않습니다.',
		accountWarningTitle: '중요: 두 번째 계정을 만들지 마세요',
		accountWarningText:
			'새 TEST Auth 계정을 만들려고 합니다. 이전에 Auth 계정을 만든 적이 있다면 새 계정을 만들지 마세요. 여러 Auth 계정은 나중에 문제를 일으킬 수 있습니다.',
		characterWarningTitle: '중요: 메인 캐릭터를 선택하세요',
		characterWarningBefore: 'EVE SSO 페이지에서 반드시 ',
		mainCharacter: '메인 캐릭터',
		characterWarningAfter:
			'를 선택하세요. 이 캐릭터는 계정에 연결되며 나중에 쉽게 변경할 수 없습니다.',
		nextTitle: '다음 단계는 무엇인가요?',
		nextSteps: [
			'아래 로그인 버튼을 누르면 EVE Online 공식 로그인 페이지로 이동됩니다',
			'메인으로 사용할 캐릭터가 있는 계정에 먼저 로그인하세요',
			'캐릭터 목록에서 메인 캐릭터를 선택하세요',
			'TEST Auth가 캐릭터 정보에 접근할 수 있도록 승인하세요',
			'로그인이 완료되면 자동으로 TEST Auth로 돌아옵니다',
		],
		securityTitle: '데이터는 안전하게 보호됩니다',
		securityText:
			'신원을 확인하고 그룹 멤버십을 관리하는 데 필요한 권한만 요청합니다. EVE Online 비밀번호는 TEST Auth에 전달되지 않습니다.',
		continueButton: 'EVE Online 로그인으로 계속',
		cancelButton: '취소',
		footer: 'EVE Online SSO 제공 • 인증 정보는 CCP Games에서 안전하게 보호됩니다',
		languageLabel: '언어',
		applyLanguage: '적용',
	},
} satisfies Record<UserLocale, LoginMessages>

export function parseLoginLocale(value: unknown): UserLocale | null {
	if (typeof value !== 'string' || value.trim() === '') {
		return null
	}

	try {
		const language = new Intl.Locale(value.trim()).language.toLowerCase()
		return supportedLocales.has(language) ? (language as UserLocale) : null
	} catch {
		return null
	}
}

function getAcceptedLanguages(header: string | null | undefined): string[] {
	if (!header) {
		return []
	}

	return header
		.split(',')
		.map((entry, index) => {
			const [language = '', ...parameters] = entry.split(';')
			const qualityParameter = parameters
				.map((parameter) => parameter.trim())
				.find((parameter) => parameter.startsWith('q='))
			const quality = qualityParameter ? Number.parseFloat(qualityParameter.slice(2)) : 1

			return {
				index,
				language: language.trim(),
				quality: Number.isFinite(quality) ? quality : 0,
			}
		})
		.filter(({ language, quality }) => language !== '*' && quality > 0 && quality <= 1)
		.sort((left, right) => right.quality - left.quality || left.index - right.index)
		.map(({ language }) => language)
}

export function resolveLoginLocale(input: {
	queryLocale?: unknown
	cookieLocale?: unknown
	acceptLanguage?: string | null
}): UserLocale {
	return (
		parseLoginLocale(input.queryLocale) ??
		parseLoginLocale(input.cookieLocale) ??
		getAcceptedLanguages(input.acceptLanguage)
			.map(parseLoginLocale)
			.find((locale): locale is UserLocale => locale !== null) ??
		DEFAULT_LOGIN_LOCALE
	)
}
