import { useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import { Popover, PopoverAnchor, PopoverContent } from './popover'

interface EveTimeDisplayProps {
	dateStr: string
	className?: string
	format?: 'full' | 'compact'
}

function formatLocalDateTime(dateStr: string): string {
	return new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short',
	}).format(new Date(dateStr))
}

function formatEveDateTime(dateStr: string, format: 'full' | 'compact'): string {
	if (format === 'compact') {
		const formatted = new Intl.DateTimeFormat('en-US', {
			year: '2-digit',
			month: 'short',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: 'UTC',
		}).format(new Date(dateStr))
		return `${formatted} EVE`
	}

	const formatted = new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: 'UTC',
	}).format(new Date(dateStr))

	return `${formatted} EVE Time`
}

export function EveTimeDisplay({ dateStr, className, format = 'full' }: EveTimeDisplayProps) {
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
			<PopoverAnchor asChild>
				<span
					className={cn('cursor-help underline decoration-dotted underline-offset-2', className)}
					onMouseEnter={openPopover}
					onMouseLeave={closePopoverSoon}
					onFocus={openPopover}
					onBlur={closePopoverSoon}
				>
					{formatEveDateTime(dateStr, format)}
				</span>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				side="top"
				className="max-w-sm p-3"
				onMouseEnter={openPopover}
				onMouseLeave={closePopoverSoon}
			>
				<div className="space-y-1">
					<p className="text-[11px] uppercase tracking-wide text-muted-foreground">Local Time</p>
					<p className="text-sm">{formatLocalDateTime(dateStr)}</p>
				</div>
			</PopoverContent>
		</Popover>
	)
}
