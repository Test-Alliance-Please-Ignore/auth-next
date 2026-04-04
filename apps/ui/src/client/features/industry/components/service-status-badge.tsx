import { CheckCircle, PauseCircle, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

import { SERVICE_STATUS_LABELS, ServiceStatus } from '../types'

import type { BadgeVariant } from '@/components/ui/badge'

const STATUS_VARIANTS: Record<ServiceStatus, { icon: typeof CheckCircle; variant: BadgeVariant }> =
	{
		[ServiceStatus.ACTIVE]: { icon: CheckCircle, variant: 'success' },
		[ServiceStatus.INACTIVE]: { icon: PauseCircle, variant: 'warning' },
		[ServiceStatus.CLOSED]: { icon: XCircle, variant: 'destructive' },
	}

interface ServiceStatusBadgeProps {
	status: ServiceStatus
	showIcon?: boolean
	className?: string
}

export function ServiceStatusBadge({
	status,
	showIcon = true,
	className,
}: ServiceStatusBadgeProps) {
	const { icon: Icon, variant } = STATUS_VARIANTS[status]
	const label = SERVICE_STATUS_LABELS[status]

	return (
		<Badge variant={variant} className={className}>
			{showIcon && <Icon className="mr-1 h-3 w-3" />}
			{label}
		</Badge>
	)
}
