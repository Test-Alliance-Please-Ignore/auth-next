import { formatNumber, useAppTranslation } from '@/i18n'

import type { AppTranslationKey } from '@/i18n'

/** Resolve toast labels at render time without retaining credential values. */
export function MumbleFeedback({
	messageKey,
	labelKey,
	count,
}: {
	messageKey: AppTranslationKey
	labelKey?: AppTranslationKey
	count?: number
}) {
	const { t } = useAppTranslation()
	return t(messageKey, {
		label: labelKey ? t(labelKey) : undefined,
		count,
		formattedCount: count === undefined ? undefined : formatNumber(count),
	})
}
