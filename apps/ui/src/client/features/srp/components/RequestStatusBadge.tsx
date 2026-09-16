import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'

import { getRequestStatusText, getRequestStatusVariant } from '../utils'

import type { RequestStatus } from '../types'

interface RequestStatusBadgeProps {
	status: RequestStatus
	className?: string
}

export function RequestStatusBadge({ status, className }: RequestStatusBadgeProps) {
	const { t } = useAppTranslation()
	return (
		<Badge variant={getRequestStatusVariant(status)} className={className}>
			{getRequestStatusText(status, t)}
		</Badge>
	)
}
