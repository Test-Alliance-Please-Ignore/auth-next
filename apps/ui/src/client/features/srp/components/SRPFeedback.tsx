import { useAppTranslation } from '@/i18n'

import type { AppTranslationKey } from '@/i18n'

/** Resolve transient feedback in the active language, even after a locale change. */
export function SRPFeedback({
	messageKey,
	values,
	labelKey,
}: {
	messageKey: AppTranslationKey
	values?: Record<string, unknown>
	labelKey?: AppTranslationKey
}) {
	const { t } = useAppTranslation()
	return t(messageKey, { ...values, ...(labelKey ? { label: t(labelKey) } : {}) })
}
