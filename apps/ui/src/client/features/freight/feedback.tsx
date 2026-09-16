import { useAppTranslation } from '@/i18n'

import type { AppTranslationKey } from '@/i18n'

/** Toasts follow the active language while preserving server-provided error details. */
export function FreightFeedback({
	messageKey,
	values,
	labelKey,
	error,
}: {
	messageKey: AppTranslationKey
	values?: Record<string, unknown>
	labelKey?: AppTranslationKey
	error?: unknown
}) {
	const { t } = useAppTranslation()
	return error instanceof Error && error.message
		? error.message
		: t(messageKey, { ...values, ...(labelKey ? { label: t(labelKey) } : {}) })
}
