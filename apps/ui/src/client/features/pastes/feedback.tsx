import { useAppTranslation } from '@/i18n'

import { PASSWORD_SYMBOLS } from './form'

import type { AppTranslationKey } from '@/i18n'

/** Toasts continue to follow the selected language after navigation or dialog closure. */
export function PasteFeedback({ messageKey }: { messageKey: AppTranslationKey }) {
	const { t } = useAppTranslation()
	return t(messageKey, { symbols: PASSWORD_SYMBOLS })
}
