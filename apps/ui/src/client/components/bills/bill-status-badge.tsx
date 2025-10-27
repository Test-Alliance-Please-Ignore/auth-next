import { Badge } from '@/components/ui/badge'
import { formatBillStatus, getBillStatusColor } from '@/lib/bills-utils'

import type { BillStatus } from '@repo/bills'

interface BillStatusBadgeProps {
	status: BillStatus
}

export function BillStatusBadge({ status }: BillStatusBadgeProps) {
	const variant = getBillStatusColor(status)

	return <Badge variant={variant}>{formatBillStatus(status)}</Badge>
}
