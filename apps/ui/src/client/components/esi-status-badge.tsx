import { AlertCircle, CheckCircle, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

type EsiBadgeVariant = 'success' | 'destructive' | 'warning'
type EsiBadgeLabel = 'ESI Valid' | 'ESI Invalid' | 'ESI Unknown' | 'Unlinked'

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
	const state = getEsiStatusBadgeState({ hasAuthAccount, hasValidToken })
	const Icon =
		state.label === 'ESI Valid'
			? CheckCircle
			: state.label === 'ESI Invalid'
				? XCircle
				: AlertCircle

	return (
		<Badge variant={state.variant} icon={Icon} className={className}>
			{state.label}
		</Badge>
	)
}

