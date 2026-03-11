import { ChevronDown, ChevronUp } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

export const popoverListScrollButtonClass =
	'flex w-full cursor-default items-center justify-center py-1 text-muted-foreground/80 hover:text-foreground'

export const popoverListViewportClass = 'p-1'

export const popoverListItemBaseClass = 'popover-list-item'
export const popoverListItemActiveClass = 'popover-list-item-active'

interface PopoverListScrollButtonProps {
	direction: 'up' | 'down'
	onClick: () => void
	className?: string
}

export function PopoverListScrollButton({
	direction,
	onClick,
	className,
}: PopoverListScrollButtonProps) {
	return (
		<button
			type="button"
			className={cn(popoverListScrollButtonClass, className)}
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
			aria-label={direction === 'up' ? 'Scroll up' : 'Scroll down'}
		>
			{direction === 'up' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
		</button>
	)
}
