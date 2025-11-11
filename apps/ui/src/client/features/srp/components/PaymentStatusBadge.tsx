import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { getPaymentStatusColor, getPaymentStatusText } from '../utils'
import type { PaymentStatus } from '../types'

interface PaymentStatusBadgeProps {
	status: PaymentStatus
	className?: string
}

export function PaymentStatusBadge({ status, className }: PaymentStatusBadgeProps) {
	return (
		<Badge className={cn('border', getPaymentStatusColor(status), className)}>
			{getPaymentStatusText(status)}
		</Badge>
	)
}
