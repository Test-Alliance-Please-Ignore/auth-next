import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { getRequestStatusColor, getRequestStatusText } from '../utils'
import type { RequestStatus } from '../types'

interface RequestStatusBadgeProps {
	status: RequestStatus
	className?: string
}

export function RequestStatusBadge({ status, className }: RequestStatusBadgeProps) {
	return (
		<Badge className={cn('border', getRequestStatusColor(status), className)}>
			{getRequestStatusText(status)}
		</Badge>
	)
}
