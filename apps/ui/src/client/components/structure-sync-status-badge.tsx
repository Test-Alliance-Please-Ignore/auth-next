import { Badge } from '@/components/ui/badge'
import type { BadgeVariant } from '@/components/ui/badge'
import { HoverPopover } from '@/components/ui/hover-popover'
import { cn } from '@/lib/utils'

interface StructureSyncStatusBadgeProps {
	status: 'ok' | 'warning' | 'error'
	description: string
	className?: string
}

function structureSyncStatusVariant(status: StructureSyncStatusBadgeProps['status']): BadgeVariant {
	if (status === 'error') return 'destructive'
	if (status === 'warning') return 'warning'
	return 'success'
}

function structureSyncStatusLabel(status: StructureSyncStatusBadgeProps['status']): string {
	if (status === 'ok') return 'Synced'
	return status.charAt(0).toUpperCase() + status.slice(1)
}

export function StructureSyncStatusBadge({ status, description, className }: StructureSyncStatusBadgeProps) {
	return (
		<HoverPopover
			align="start"
			side="top"
			className="w-80 space-y-2"
			trigger={
				<span className={cn('inline-flex cursor-help', className)}>
					<Badge variant={structureSyncStatusVariant(status)}>{structureSyncStatusLabel(status)}</Badge>
				</span>
			}
		>
			<div className="space-y-1">
				<div className="text-sm font-medium">Sync Status</div>
				<div className="text-sm text-muted-foreground">{description}</div>
			</div>
		</HoverPopover>
	)
}
