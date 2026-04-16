import { useRef, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { ReactNode } from 'react'
import type { ComponentPropsWithoutRef } from 'react'

type PopoverContentProps = ComponentPropsWithoutRef<typeof PopoverContent>

interface HoverPopoverProps {
	trigger: ReactNode
	children: ReactNode
	align?: PopoverContentProps['align']
	side?: PopoverContentProps['side']
	sideOffset?: number
	className?: string
}

export function HoverPopover({
	trigger,
	children,
	align = 'center',
	side = 'bottom',
	sideOffset = 8,
	className,
}: HoverPopoverProps) {
	const [open, setOpen] = useState(false)
	const closeTimeoutRef = useRef<number | null>(null)

	const clearCloseTimeout = () => {
		if (closeTimeoutRef.current !== null) {
			window.clearTimeout(closeTimeoutRef.current)
			closeTimeoutRef.current = null
		}
	}

	const openPopover = () => {
		clearCloseTimeout()
		setOpen(true)
	}

	const closePopoverSoon = () => {
		clearCloseTimeout()
		closeTimeoutRef.current = window.setTimeout(() => {
			setOpen(false)
		}, 80)
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<span
					className="inline-block"
					onMouseEnter={openPopover}
					onMouseLeave={closePopoverSoon}
					onFocus={openPopover}
					onBlur={closePopoverSoon}
				>
					{trigger}
				</span>
			</PopoverTrigger>
			<PopoverContent
				align={align}
				side={side}
				sideOffset={sideOffset}
				className={cn(className)}
				onMouseEnter={openPopover}
				onMouseLeave={closePopoverSoon}
			>
				{children}
			</PopoverContent>
		</Popover>
	)
}

