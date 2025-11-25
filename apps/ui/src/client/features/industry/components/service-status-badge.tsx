import { CheckCircle, PauseCircle, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { SERVICE_STATUS_LABELS, ServiceStatus } from '../types'

const STATUS_VARIANTS: Record<ServiceStatus, { icon: typeof CheckCircle; className: string }> = {
	[ServiceStatus.ACTIVE]: {
		icon: CheckCircle,
		className: 'bg-green-500/10 text-green-500 border-green-500/20',
	},
	[ServiceStatus.INACTIVE]: {
		icon: PauseCircle,
		className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
	},
	[ServiceStatus.CLOSED]: {
		icon: XCircle,
		className: 'bg-red-500/10 text-red-500 border-red-500/20',
	},
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
	const { icon: Icon, className: variantClassName } = STATUS_VARIANTS[status]
	const label = SERVICE_STATUS_LABELS[status]

	return (
		<Badge variant="outline" className={cn(variantClassName, className)}>
			{showIcon && <Icon className="mr-1 h-3 w-3" />}
			{label}
		</Badge>
	)
}
