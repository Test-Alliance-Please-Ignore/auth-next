import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'

import type { BadgeVariant } from '@/components/ui/badge'
import type { AppTranslationKey } from '@/i18n'
import type { BroadcastStatus, DeliveryStatus } from '@/lib/api'

const statuses: Record<
	BroadcastStatus | DeliveryStatus,
	{ key: AppTranslationKey; variant: BadgeVariant }
> = {
	draft: { key: 'broadcasts.status.draft', variant: 'secondary' },
	scheduled: { key: 'broadcasts.status.scheduled', variant: 'default' },
	sending: { key: 'broadcasts.status.sending', variant: 'warning' },
	sent: { key: 'broadcasts.status.sent', variant: 'success' },
	failed: { key: 'broadcasts.status.failed', variant: 'destructive' },
	rescinded: { key: 'broadcasts.status.rescinded', variant: 'warning' },
	pending: { key: 'broadcasts.status.pending', variant: 'ghost' },
}

export function BroadcastStatusBadge({ status }: { status: string }) {
	const { t } = useAppTranslation()
	const entry = Object.hasOwn(statuses, status)
		? statuses[status as keyof typeof statuses]
		: undefined
	return <Badge variant={entry?.variant ?? 'secondary'}>{entry ? t(entry.key) : status}</Badge>
}
