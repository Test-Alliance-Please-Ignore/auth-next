import { typeIconUrl } from '@/lib/eve-images'

import type { ReactNode } from 'react'

interface FittingListItemProps {
	shipTypeId: string
	shipName: string
	name: string
	category: string
	selected?: boolean
	onClick?: () => void
	actions?: ReactNode
	children?: ReactNode
}

export function FittingListItem({
	shipTypeId,
	shipName,
	name,
	category,
	selected,
	onClick,
	actions,
	children,
}: FittingListItemProps) {
	const baseClass = 'flex items-center justify-between rounded-md border px-3 py-2'
	const interactiveClass = onClick
		? `cursor-pointer hover:bg-accent/50 ${selected ? 'bg-accent' : ''}`
		: ''

	return (
		<div className={`${baseClass} ${interactiveClass}`} onClick={onClick}>
			<div className="flex items-center gap-3 min-w-0">
				<img
					src={typeIconUrl(shipTypeId, 64)}
					alt={shipName}
					className="h-8 w-8 rounded shrink-0"
					loading="lazy"
				/>
				<div className="min-w-0">
					<span className="font-medium truncate block">{name}</span>
					<span className="text-xs text-muted-foreground truncate block">
						{shipName} &middot; {category}
					</span>
				</div>
				{children}
			</div>
			{actions && <div className="flex gap-1 shrink-0 ml-2">{actions}</div>}
		</div>
	)
}
