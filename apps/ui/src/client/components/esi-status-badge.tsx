import { AlertCircle, CheckCircle, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'

import type { AppTranslationKey } from '@/i18n'

type EsiBadgeVariant = 'success' | 'destructive' | 'warning'
type EsiBadgeLabel = 'ESI Valid' | 'ESI Invalid' | 'ESI Unknown' | 'Unlinked'

// Keep the status helper's semantic labels stable for existing callers.
const statusLabelKeys: Record<EsiBadgeLabel, AppTranslationKey> = {
	'ESI Valid': 'common.esiStatus.valid',
	'ESI Invalid': 'common.esiStatus.invalid',
	'ESI Unknown': 'common.esiStatus.unknown',
	Unlinked: 'common.esiStatus.unlinked',
}

export function getEsiStatusBadgeState(member: {
	hasAuthAccount: boolean
	hasValidToken: boolean | null | undefined
}): {
	variant: EsiBadgeVariant
	label: EsiBadgeLabel
} {
	if (!member.hasAuthAccount) {
		return {
			variant: 'warning',
			label: 'Unlinked',
		}
	}

	if (member.hasValidToken === true) {
		return {
			variant: 'success',
			label: 'ESI Valid',
		}
	}

	if (member.hasValidToken === false) {
		return {
			variant: 'destructive',
			label: 'ESI Invalid',
		}
	}

	return {
		variant: 'warning',
		label: 'ESI Unknown',
	}
}

export function EsiStatusBadge({
	hasAuthAccount,
	hasValidToken,
	className,
}: {
	hasAuthAccount: boolean
	hasValidToken: boolean | null | undefined
	className?: string
}) {
	const { t } = useAppTranslation()
	const state = getEsiStatusBadgeState({ hasAuthAccount, hasValidToken })
	const Icon =
		state.label === 'ESI Valid'
			? CheckCircle
			: state.label === 'ESI Invalid'
				? XCircle
				: AlertCircle

	return (
		<Badge variant={state.variant} icon={Icon} className={className}>
			{t(statusLabelKeys[state.label])}
		</Badge>
	)
}
