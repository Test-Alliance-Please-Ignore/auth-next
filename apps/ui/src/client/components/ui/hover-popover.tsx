import { useEffect, useState } from 'react'

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
	fullWidth?: boolean
}

export function HoverPopover({
	trigger,
	children,
	align = 'center',
	side = 'bottom',
	sideOffset = 8,
	className,
	fullWidth = false,
}: HoverPopoverProps) {
	const [open, setOpen] = useState(false)
	const [isTriggerHover, setIsTriggerHover] = useState(false)
	const [isContentHover, setIsContentHover] = useState(false)

	useEffect(() => {
		setOpen(isTriggerHover || isContentHover)
	}, [isTriggerHover, isContentHover])

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<span
					className={fullWidth ? 'inline-block w-full' : 'inline-block'}
					onMouseEnter={() => setIsTriggerHover(true)}
					onMouseLeave={() => setIsTriggerHover(false)}
					onFocus={() => setIsTriggerHover(true)}
					onBlur={() => setIsTriggerHover(false)}
				>
					{trigger}
				</span>
			</PopoverTrigger>
			<PopoverContent
				align={align}
				side={side}
				sideOffset={sideOffset}
				className={cn(className)}
				onMouseEnter={() => setIsContentHover(true)}
				onMouseLeave={() => setIsContentHover(false)}
			>
				{children}
			</PopoverContent>
		</Popover>
	)
}
