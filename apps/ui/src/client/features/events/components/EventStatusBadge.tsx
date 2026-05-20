import { Badge } from '@/components/ui/badge'

import { EVENT_STATUS } from '../types'

const STATUS_META: Record<number, { label: string; variant: 'success' | 'secondary' | 'destructive' | 'default' }> = {
	[EVENT_STATUS.SCHEDULED]: { label: 'Scheduled', variant: 'success' },
	[EVENT_STATUS.ACTIVE]: { label: 'Live', variant: 'default' },
	[EVENT_STATUS.COMPLETED]: { label: 'Completed', variant: 'secondary' },
	[EVENT_STATUS.CANCELED]: { label: 'Cancelled', variant: 'destructive' },
}

/**
 * Badge reflecting a Discord scheduled event's status.
 */
export function EventStatusBadge({ status }: { status: number }) {
	const meta = STATUS_META[status] ?? { label: 'Unknown', variant: 'secondary' as const }
	return (
		<Badge variant={meta.variant} className="text-xs">
			{meta.label}
		</Badge>
	)
}
