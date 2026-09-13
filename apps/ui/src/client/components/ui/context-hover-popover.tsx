import { HoverPopover } from '@/components/ui/hover-popover'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import type { ReactNode } from 'react'

interface ContextHoverPopoverProps {
	trigger: ReactNode
	title: string
	items: string[]
	className?: string
	triggerClassName?: string
}

export function ContextHoverPopover({
	trigger,
	title,
	items,
	className,
	triggerClassName,
}: ContextHoverPopoverProps) {
	const { t } = useAppTranslation()

	return (
		<HoverPopover
			trigger={<span className={cn('cursor-help', triggerClassName)}>{trigger}</span>}
			side="top"
			align="start"
			className={cn(
				'max-w-sm border border-border bg-popover p-3 text-popover-foreground shadow-lg',
				className
			)}
		>
			<div className="space-y-2 text-xs">
				<div className="font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
				{items.length > 0 ? (
					<ul className="space-y-1">
						{items.map((item, index) => (
							<li key={`${title}:${index}`} className="break-words">
								{item}
							</li>
						))}
					</ul>
				) : (
					<p>{t('common.noAdditionalContext')}</p>
				)}
			</div>
		</HoverPopover>
	)
}
