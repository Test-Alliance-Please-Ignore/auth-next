import { Copy } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { DataTable } from '@/components/data-table'
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
import { useAppTranslation } from '@/i18n'
import { formatDiscordTimestamp } from '@/lib/discord-time'

import type { DataTableColumn } from '@/components/data-table'

interface DiscordTimestampHelperDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

type TimeMode = 'local' | 'eve'
type TimestampFormat = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R'

const DISCORD_TIMESTAMP_FORMATS: TimestampFormat[] = ['t', 'T', 'd', 'D', 'f', 'F', 'R']

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

export function DiscordTimestampHelperDialog({
	open,
	onOpenChange,
}: DiscordTimestampHelperDialogProps) {
	const { t } = useAppTranslation()
	const [now, setNow] = useState(Date.now)
	const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	useEffect(
		() => () => {
			if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
		},
		[]
	)
	useEffect(() => {
		if (!open) return
		const timer = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(timer)
	}, [open])
	const timestampInputRef = useRef<HTMLInputElement | null>(null)
	const [timeMode, setTimeMode] = useState<TimeMode>('local')
	const [timestampInput, setTimestampInput] = useState<string>(() =>
		toDateTimeLocalValue(startOfNextHour(new Date()))
	)
	const [copiedFormat, setCopiedFormat] = useState<TimestampFormat | null>(null)
	const [copyFailed, setCopyFailed] = useState(false)

	const timestampDate = useMemo(
		() => parseDateTimeInput(timestampInput, timeMode),
		[timestampInput, timeMode]
	)
	const minTimestampInput = useMemo(
		() =>
			timeMode === 'eve'
				? toDateTimeLocalValueUtc(roundUpToNextMinute(new Date(now)))
				: toDateTimeLocalValue(roundUpToNextMinute(new Date(now))),
		[timeMode, now]
	)
	const timestampError = !timestampDate
		? t('broadcasts.composer.timestamp.invalid')
		: timestampDate.getTime() <= now
			? t('broadcasts.composer.timestamp.future')
			: null

	const timestampEpoch = timestampDate ? Math.floor(timestampDate.getTime() / 1000) : null

	const handleTimeModeChange = (nextMode: TimeMode) => {
		const currentParsed = parseDateTimeInput(timestampInput, timeMode)
		setTimeMode(nextMode)
		setCopyFailed(false)
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
		if (timestampDate && timestampDate.getTime() <= Date.now()) {
			setNow(Date.now())
			return
		}
		const token = `<t:${timestampEpoch}:${format}>`
		try {
			await navigator.clipboard.writeText(token)
			setCopyFailed(false)
			setCopiedFormat(format)
			if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
			copyTimerRef.current = setTimeout(() => setCopiedFormat(null), 1500)
		} catch {
			setCopyFailed(true)
		}
	}

	const columns: Array<DataTableColumn<TimestampFormat>> = [
		{
			id: 'style',
			header: t('broadcasts.composer.timestamp.style'),
			cell: (code) => t(`broadcasts.composer.timestamp.styles.${code}`),
		},
		{
			id: 'preview',
			header: t('broadcasts.composer.preview'),
			cell: (code) => (timestampDate ? formatDiscordTimestamp(timestampDate, code) : '—'),
			className: 'text-muted-foreground whitespace-normal',
		},
		{
			id: 'copy',
			header: t('broadcasts.composer.timestamp.copy'),
			className: 'text-right',
			headerClassName: 'text-right',
			cell: (code) => (
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => void handleCopyTimestamp(code)}
					disabled={!timestampEpoch || Boolean(timestampError)}
					aria-label={t('broadcasts.composer.timestamp.copyLabel', {
						style: t(`broadcasts.composer.timestamp.styles.${code}`),
					})}
				>
					<Copy className="h-4 w-4 mr-1" />
					{copiedFormat === code
						? t('broadcasts.composer.timestamp.copied')
						: t('broadcasts.composer.timestamp.copy')}
				</Button>
			),
		},
	]

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
					<DialogTitle>{t('broadcasts.composer.timestamp.title')}</DialogTitle>
					<DialogDescription>{t('broadcasts.composer.timestamp.description')}</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="timestamp-time-mode">{t('broadcasts.composer.timestamp.zone')}</Label>
							<Select
								inputId="timestamp-time-mode"
								value={timeMode}
								onValueChange={(value) => handleTimeModeChange(value as TimeMode)}
								options={[
									{ value: 'local', label: t('broadcasts.composer.timestamp.local') },
									{ value: 'eve', label: t('broadcasts.composer.timestamp.eve') },
								]}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="timestamp-input">{t('broadcasts.composer.timestamp.date')}</Label>
							<Input
								ref={timestampInputRef}
								id="timestamp-input"
								type="datetime-local"
								value={timestampInput}
								min={minTimestampInput}
								onChange={(e) => {
									setCopyFailed(false)
									setTimestampInput(e.target.value)
								}}
							/>
						</div>
					</div>
					<p className="text-xs text-muted-foreground">{t('broadcasts.composer.timestamp.help')}</p>

					{timestampError ? (
						<p role="alert" className="text-sm text-destructive">
							{timestampError}
						</p>
					) : timestampEpoch ? (
						<p className="text-sm text-muted-foreground">
							{t('broadcasts.composer.timestamp.epoch')}{' '}
							<span className="font-mono">{timestampEpoch}</span>
						</p>
					) : null}
					{copyFailed ? (
						<p role="alert" className="text-sm text-destructive">
							{t('broadcasts.composer.timestamp.copyFailed')}
						</p>
					) : null}

					<div className="space-y-2">
						<Label>{t('broadcasts.composer.timestamp.formats')}</Label>
						<div className="max-h-72 overflow-y-auto">
							<DataTable
								columns={columns}
								rows={DISCORD_TIMESTAMP_FORMATS}
								getRowKey={(code) => code}
								emptyMessage=""
								variant="plain"
							/>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button type="button" variant="confirm" onClick={() => onOpenChange(false)}>
						{t('broadcasts.composer.timestamp.done')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
