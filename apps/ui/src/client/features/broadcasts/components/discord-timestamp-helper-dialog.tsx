import { Copy } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

interface DiscordTimestampHelperDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

type TimeMode = 'local' | 'eve'
type TimestampFormat = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R'

const DISCORD_TIMESTAMP_FORMATS: Array<{
	code: TimestampFormat
	label: string
}> = [
	{ code: 't', label: 'Short Time' },
	{ code: 'T', label: 'Long Time' },
	{ code: 'd', label: 'Short Date' },
	{ code: 'D', label: 'Long Date' },
	{ code: 'f', label: 'Short Date/Time' },
	{ code: 'F', label: 'Long Date/Time' },
	{ code: 'R', label: 'Relative Time' },
]

function toDateTimeLocalValue(date: Date): string {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	const hours = String(date.getHours()).padStart(2, '0')
	const minutes = String(date.getMinutes()).padStart(2, '0')
	return `${year}-${month}-${day}T${hours}:${minutes}`
}

function toDateTimeLocalValueUtc(date: Date): string {
	const year = date.getUTCFullYear()
	const month = String(date.getUTCMonth() + 1).padStart(2, '0')
	const day = String(date.getUTCDate()).padStart(2, '0')
	const hours = String(date.getUTCHours()).padStart(2, '0')
	const minutes = String(date.getUTCMinutes()).padStart(2, '0')
	return `${year}-${month}-${day}T${hours}:${minutes}`
}

function roundUpToNextMinute(date: Date): Date {
	const next = new Date(date)
	next.setSeconds(0, 0)
	next.setMinutes(next.getMinutes() + 1)
	return next
}

function startOfNextHour(date: Date): Date {
	const next = new Date(date)
	next.setMinutes(0, 0, 0)
	next.setHours(next.getHours() + 1)
	return next
}

function parseDateTimeInput(value: string, mode: TimeMode): Date | null {
	if (!value) return null
	const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
	if (!local) return null

	if (mode === 'local') {
		const date = new Date(value)
		return Number.isNaN(date.getTime()) ? null : date
	}

	const [datePart, timePart] = value.split('T')
	if (!datePart || !timePart) return null
	const [year, month, day] = datePart.split('-').map(Number)
	const [hours, minutes] = timePart.split(':').map(Number)
	if (
		![year, month, day, hours, minutes].every(Number.isFinite) ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > 31 ||
		hours < 0 ||
		hours > 23 ||
		minutes < 0 ||
		minutes > 59
	) {
		return null
	}
	return new Date(Date.UTC(year, month - 1, day, hours, minutes, 0))
}

function formatRelativeFromNow(target: Date): string {
	const diffMs = target.getTime() - Date.now()
	const absMs = Math.abs(diffMs)
	const minute = 60_000
	const hour = 60 * minute
	const day = 24 * hour

	if (absMs < minute) return diffMs >= 0 ? 'in <1 minute' : '<1 minute ago'
	if (absMs < hour) {
		const mins = Math.round(absMs / minute)
		return diffMs >= 0
			? `in ${mins} minute${mins === 1 ? '' : 's'}`
			: `${mins} minute${mins === 1 ? '' : 's'} ago`
	}
	if (absMs < day) {
		const hours = Math.round(absMs / hour)
		return diffMs >= 0
			? `in ${hours} hour${hours === 1 ? '' : 's'}`
			: `${hours} hour${hours === 1 ? '' : 's'} ago`
	}
	const days = Math.round(absMs / day)
	return diffMs >= 0
		? `in ${days} day${days === 1 ? '' : 's'}`
		: `${days} day${days === 1 ? '' : 's'} ago`
}

function getFormatPreview(date: Date, format: TimestampFormat): string {
	switch (format) {
		case 't':
			return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
		case 'T':
			return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
		case 'd':
			return date.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' })
		case 'D':
			return date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
		case 'f':
			return date.toLocaleString([], {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit',
			})
		case 'F':
			return date.toLocaleString([], {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit',
			})
		case 'R':
			return formatRelativeFromNow(date)
	}
}

export function DiscordTimestampHelperDialog({
	open,
	onOpenChange,
}: DiscordTimestampHelperDialogProps) {
	const timestampInputRef = useRef<HTMLInputElement | null>(null)
	const [timeMode, setTimeMode] = useState<TimeMode>('local')
	const [timestampInput, setTimestampInput] = useState<string>(() =>
		toDateTimeLocalValue(startOfNextHour(new Date()))
	)
	const [copiedFormat, setCopiedFormat] = useState<TimestampFormat | null>(null)
	const [copyError, setCopyError] = useState<string | null>(null)

	const timestampDate = useMemo(
		() => parseDateTimeInput(timestampInput, timeMode),
		[timestampInput, timeMode]
	)
	const minTimestampInput = useMemo(
		() =>
			timeMode === 'eve'
				? toDateTimeLocalValueUtc(roundUpToNextMinute(new Date()))
				: toDateTimeLocalValue(roundUpToNextMinute(new Date())),
		[timeMode]
	)
	const timestampError = useMemo(() => {
		if (!timestampDate) return 'Enter a valid date/time'
		if (timestampDate.getTime() <= Date.now()) return 'Date/time must be in the future'
		return null
	}, [timestampDate])
	const timestampEpoch = timestampDate ? Math.floor(timestampDate.getTime() / 1000) : null

	const handleTimeModeChange = (nextMode: TimeMode) => {
		const currentParsed = parseDateTimeInput(timestampInput, timeMode)
		setTimeMode(nextMode)
		setCopyError(null)
		if (!currentParsed) {
			const fallback = startOfNextHour(new Date())
			setTimestampInput(
				nextMode === 'eve' ? toDateTimeLocalValueUtc(fallback) : toDateTimeLocalValue(fallback)
			)
			return
		}
		setTimestampInput(
			nextMode === 'eve'
				? toDateTimeLocalValueUtc(currentParsed)
				: toDateTimeLocalValue(currentParsed)
		)
	}

	const handleCopyTimestamp = async (format: TimestampFormat) => {
		if (!timestampEpoch || timestampError) return
		const token = `<t:${timestampEpoch}:${format}>`
		try {
			await navigator.clipboard.writeText(token)
			setCopyError(null)
			setCopiedFormat(format)
			setTimeout(() => setCopiedFormat((current) => (current === format ? null : current)), 1500)
		} catch {
			setCopyError('Failed to copy timestamp token.')
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-2xl"
				onOpenAutoFocus={(event) => {
					event.preventDefault()
					timestampInputRef.current?.focus()
				}}
			>
				<DialogHeader>
					<DialogTitle>Discord Timestamp Helper</DialogTitle>
					<DialogDescription>
						Pick a future date/time and copy Discord timestamp tokens.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="timestamp-time-mode">Time Zone</Label>
							<Select
								inputId="timestamp-time-mode"
								value={timeMode}
								onValueChange={(value) => handleTimeModeChange(value as TimeMode)}
								options={[
									{ value: 'local', label: 'Local Time' },
									{ value: 'eve', label: 'EVE Time (UTC)' },
								]}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="timestamp-input">Date & Time</Label>
							<Input
								ref={timestampInputRef}
								id="timestamp-input"
								type="datetime-local"
								value={timestampInput}
								min={minTimestampInput}
								onChange={(e) => {
									setCopyError(null)
									setTimestampInput(e.target.value)
								}}
							/>
						</div>
					</div>
					<p className="text-xs text-muted-foreground">
						Time Zone controls how you choose the date/time in this helper only. Discord renders the
						timestamp in each viewer&apos;s local time.
					</p>

					{timestampError ? (
						<p className="text-sm text-destructive">{timestampError}</p>
					) : timestampEpoch ? (
						<p className="text-sm text-muted-foreground">
							Epoch: <span className="font-mono">{timestampEpoch}</span>
						</p>
					) : null}
					{copyError ? <p className="text-sm text-destructive">{copyError}</p> : null}

					<div className="space-y-2">
						<Label>Discord Format Tokens</Label>
						<div className="max-h-72 overflow-y-auto rounded-md border border-border/60">
							<table className="w-full text-sm">
								<thead className="bg-muted/30">
									<tr>
										<th className="text-left px-3 py-2 font-medium">Style</th>
										<th className="text-left px-3 py-2 font-medium">Preview</th>
										<th className="text-right px-3 py-2 font-medium">Copy</th>
									</tr>
								</thead>
								<tbody>
									{DISCORD_TIMESTAMP_FORMATS.map((item) => (
										<tr key={item.code} className="border-t border-border/50">
											<td className="px-3 py-2">
												<div className="font-medium">{item.label}</div>
											</td>
											<td className="px-3 py-2 text-muted-foreground">
												{timestampDate ? getFormatPreview(timestampDate, item.code) : '—'}
											</td>
											<td className="px-3 py-2 text-right">
												<Button
													type="button"
													size="sm"
													variant="ghost"
													onClick={() => handleCopyTimestamp(item.code)}
													disabled={!timestampEpoch || Boolean(timestampError)}
												>
													<Copy className="h-4 w-4 mr-1" />
													{copiedFormat === item.code ? 'Copied' : 'Copy'}
												</Button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button type="button" variant="confirm" onClick={() => onOpenChange(false)}>
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
