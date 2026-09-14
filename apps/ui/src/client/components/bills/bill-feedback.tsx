import { useAppTranslation } from '@/i18n'

import type { AppTranslationKey } from '@/i18n'

/** Resolve copy inside the toast so it follows locale changes after an action closes. */
export function BillFeedback({
	messageKey,
	error,
}: {
	messageKey: AppTranslationKey
	error?: unknown
}) {
	const { t } = useAppTranslation()
	return error instanceof Error && error.message ? error.message : t(messageKey)
}
