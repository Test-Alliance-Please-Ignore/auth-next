import { Badge } from '@/components/ui/badge'
import { formatBillStatus, getBillStatusColor } from '@/lib/bills-utils'

import type { BillStatus } from '@repo/bills'

interface BillStatusBadgeProps {
	status: BillStatus | 'unbilled'
}

export function BillStatusBadge({ status }: BillStatusBadgeProps) {
	const variant = status === 'unbilled' ? 'ghost' : getBillStatusColor(status)
	const label = status === 'unbilled' ? 'Unbilled' : formatBillStatus(status)

	return <Badge variant={variant}>{label}</Badge>
}
