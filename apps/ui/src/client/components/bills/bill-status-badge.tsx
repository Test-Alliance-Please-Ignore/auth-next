import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'
import { formatBillStatus, getBillStatusColor } from '@/lib/bills-utils'

import type { BillStatus } from '@repo/bills'

interface BillStatusBadgeProps {
	status: BillStatus | 'unbilled'
}

export function BillStatusBadge({ status }: BillStatusBadgeProps) {
	useAppTranslation()
	const variant = status === 'unbilled' ? 'ghost' : getBillStatusColor(status)
	const label = formatBillStatus(status)

	return <Badge variant={variant}>{label}</Badge>
}
