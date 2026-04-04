import { Badge } from '@/components/ui/badge'

import { getRequestStatusText, getRequestStatusVariant } from '../utils'

import type { RequestStatus } from '../types'

interface RequestStatusBadgeProps {
	status: RequestStatus
	className?: string
}

export function RequestStatusBadge({ status, className }: RequestStatusBadgeProps) {
	return (
		<Badge variant={getRequestStatusVariant(status)} className={className}>
			{getRequestStatusText(status)}
		</Badge>
	)
}
