import { formatNumber } from '@/i18n'

import type { AppTranslationKey, AppTranslator } from '@/i18n'

export const EXPIRATION_PRESETS = [
	60,
	180,
	360,
	720,
	1440,
	4320,
	10080,
	20160,
	43200,
	'indefinite',
] as const
export type ExpirationValue = number | 'indefinite'
export const PASSWORD_SYMBOLS = '! @ # $ % ^ & * - _ = + , . ? / | ~ ` :'
const PASSWORD_PATTERN =
	/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*_\-+=,.?/|~`:])[A-Za-z0-9!@#$%^&*_\-+=,.?/|~`:]{8,128}$/

export function getPasswordValidationError(password: string): AppTranslationKey | null {
	if (!password.trim()) return 'pastes.passwordRequired'
	return PASSWORD_PATTERN.test(password) ? null : 'pastes.passwordInvalid'
}

export function getPasswordChecks(
	password: string
): Array<{ key: AppTranslationKey; valid: boolean }> {
	return [
		{ key: 'pastes.passwordLength', valid: password.length >= 8 && password.length <= 128 },
		{ key: 'pastes.passwordUpper', valid: /[A-Z]/.test(password) },
		{ key: 'pastes.passwordLower', valid: /[a-z]/.test(password) },
		{ key: 'pastes.passwordNumber', valid: /\d/.test(password) },
		{ key: 'pastes.passwordSymbol', valid: /[!@#$%^&*_\-+=,.?/|~`:]/.test(password) },
	]
}

export function getExpirationOptions(t: AppTranslator) {
	return EXPIRATION_PRESETS.map((value) => {
		if (value === 'indefinite') return { value, label: t('pastes.indefinite') }
		const count = value < 1440 ? value / 60 : value / 1440
		return {
			value: String(value),
			label: t(value < 1440 ? 'pastes.expirationHours' : 'pastes.expirationDays', {
				count,
				formattedCount: formatNumber(count),
			}),
		}
	})
}
