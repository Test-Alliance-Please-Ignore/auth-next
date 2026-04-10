import { ChevronDown, ChevronUp } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

export const popoverListScrollButtonClass =
	'absolute left-0 right-0 z-10 flex h-6 cursor-default items-center justify-center text-muted-foreground/80 transition-opacity hover:text-foreground'

export const popoverListViewportClass = 'p-1'

export const popoverListItemBaseClass = 'popover-list-item'
export const popoverListItemActiveClass = 'popover-list-item-active'

interface PopoverListScrollButtonProps {
	direction: 'up' | 'down'
	onClick: () => void
	visible?: boolean
	className?: string
}

export function PopoverListScrollButton({
	direction,
	onClick,
	visible = true,
	className,
}: PopoverListScrollButtonProps) {
	return (
		<button
			type="button"
			className={cn(
				popoverListScrollButtonClass,
				direction === 'up'
					? 'top-0 bg-gradient-to-b from-popover via-popover/95 to-transparent'
					: 'bottom-0 bg-gradient-to-t from-popover via-popover/95 to-transparent',
				visible ? 'opacity-100' : 'pointer-events-none opacity-0',
				className
			)}
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
			aria-label={direction === 'up' ? 'Scroll up' : 'Scroll down'}
			aria-hidden={!visible}
			tabIndex={visible ? 0 : -1}
		>
			{direction === 'up' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
		</button>
	)
}
