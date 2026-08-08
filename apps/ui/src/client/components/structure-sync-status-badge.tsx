import { Badge } from '@/components/ui/badge'
import { HoverPopover } from '@/components/ui/hover-popover'
import { cn } from '@/lib/utils'

import type { BadgeVariant } from '@/components/ui/badge'

interface StructureSyncStatusBadgeProps {
	status: 'ok' | 'warning' | 'error' | 'disabled'
	description: string
	label?: string
	className?: string
}

function structureSyncStatusVariant(status: StructureSyncStatusBadgeProps['status']): BadgeVariant {
	if (status === 'error') return 'destructive'
	if (status === 'warning') return 'warning'
	if (status === 'disabled') return 'ghost'
	return 'success'
}

function structureSyncStatusLabel(status: StructureSyncStatusBadgeProps['status']): string {
	if (status === 'ok') return 'Synced'
	if (status === 'disabled') return 'Disabled'
	return status.charAt(0).toUpperCase() + status.slice(1)
}

export function StructureSyncStatusBadge({
	status,
	description,
	label,
	className,
}: StructureSyncStatusBadgeProps) {
	const statusLabel = structureSyncStatusLabel(status)
	const displayLabel = label ? `${label}: ${statusLabel}` : statusLabel
	const popoverTitle = label ? `${label} Sync` : 'Sync Status'

	return (
		<HoverPopover
			align="start"
			side="top"
			className="w-80 space-y-2"
			trigger={
				<span className={cn('inline-flex cursor-help', className)}>
					<Badge variant={structureSyncStatusVariant(status)}>{displayLabel}</Badge>
				</span>
			}
		>
			<div className="space-y-1">
				<div className="text-sm font-medium">{popoverTitle}</div>
				<div className="text-sm text-muted-foreground">{description}</div>
			</div>
		</HoverPopover>
	)
}
