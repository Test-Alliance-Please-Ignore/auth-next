import { Badge } from '@/components/ui/badge'
import { HoverPopover } from '@/components/ui/hover-popover'
import { i18n, useAppTranslation } from '@/i18n'
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
	if (status === 'ok') return i18n.t('structures.synced')
	if (status === 'disabled') return i18n.t('structures.disabled')
	return status === 'warning'
		? i18n.t('structures.warningStatus')
		: i18n.t('structures.errorStatus')
}

export function StructureSyncStatusBadge({
	status,
	description,
	label,
	className,
}: StructureSyncStatusBadgeProps) {
	const { t } = useAppTranslation()

	const statusLabel = structureSyncStatusLabel(status)
	const displayLabel = label ? `${label}: ${statusLabel}` : statusLabel
	const popoverTitle = label
		? t('structures.syncLabel', { value1: label })
		: t('structures.syncStatus')

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
