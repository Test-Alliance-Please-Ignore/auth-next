import { useRef, useState } from 'react'

import { formatDateTimeWithZone, formatUtcDateTime } from '@/lib/date-utils'
import { formatDurationUntil } from '@/lib/duration-utils'
import { cn } from '@/lib/utils'

import { Popover, PopoverAnchor, PopoverContent } from './popover'

interface DurationDisplayProps {
	endDate: string
	className?: string
	format?: 'full' | 'compact'
	durationStyle?: 'long' | 'short' | 'compact'
	maxUnits?: number
	referenceTimeMs?: number
}

export function DurationDisplay({
	endDate,
	className,
	format = 'compact',
	durationStyle = 'long',
	maxUnits = 3,
	referenceTimeMs,
}: DurationDisplayProps) {
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

	const formattedDuration = formatDurationUntil(endDate, {
		expiredLabel: 'Expired',
		maxUnits,
		style: durationStyle,
		referenceTimeMs,
	})

	const formattedVisible =
		format === 'full' ? `${formattedDuration} remaining` : formattedDuration

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverAnchor asChild>
				<span
					className={cn('cursor-help underline decoration-dotted underline-offset-2', className)}
					onMouseEnter={openPopover}
					onMouseLeave={closePopoverSoon}
					onFocus={openPopover}
					onBlur={closePopoverSoon}
				>
					{formattedVisible}
				</span>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				side="top"
				className="max-w-sm p-3"
				onMouseEnter={openPopover}
				onMouseLeave={closePopoverSoon}
			>
				<div className="space-y-3">
					<div className="space-y-1">
						<p className="text-[11px] uppercase tracking-wide text-muted-foreground">Local Time</p>
						<p className="text-sm">{formatDateTimeWithZone(endDate)}</p>
					</div>
					<div className="space-y-1">
						<p className="text-[11px] uppercase tracking-wide text-muted-foreground">EVE Time</p>
						<p className="text-sm">{formatUtcDateTime(endDate)}</p>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
