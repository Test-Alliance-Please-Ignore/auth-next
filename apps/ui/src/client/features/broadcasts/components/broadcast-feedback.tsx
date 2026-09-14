import { useAppTranslation } from '@/i18n'

import type { AppTranslationKey } from '@/i18n'

/** Keep toast copy responsive to locale changes after its originating dialog closes. */
export function BroadcastFeedback({
	messageKey,
	error,
}: {
	messageKey: AppTranslationKey
	error?: unknown
}) {
	const { t } = useAppTranslation()
	return error instanceof Error && error.message
		? error.message
		: t(messageKey, { error: typeof error === 'string' ? error : undefined })
}
