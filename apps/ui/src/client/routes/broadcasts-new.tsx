import { Copy } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { renderDiscordContentValue } from '@/components/discord-content-renderer'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
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
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
	useBroadcastTargets,
	useBroadcastTemplates,
	useCreateBroadcast,
	useSendBroadcast,
} from '@/hooks/useBroadcasts'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { BroadcastTemplate } from '@/lib/api'

type TimeMode = 'local' | 'eve'
type TimestampFormat = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R'

const DISCORD_TIMESTAMP_FORMATS: Array<{ code: TimestampFormat; label: string }> = [
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

export default function NewBroadcastPage() {
	usePageTitle('New Broadcast')
	const navigate = useNavigate()
	const createBroadcast = useCreateBroadcast()
	const sendBroadcast = useSendBroadcast()

	// Form state
	const [selectedTargetId, setSelectedTargetId] = useState<string>('')
	const [selectedTemplateId, setSelectedTemplateId] = useState<string>('custom')
	const [customMessage, setCustomMessage] = useState<string>('')
	const [templateFields, setTemplateFields] = useState<Record<string, string>>({})
	const [mentionLevel, setMentionLevel] = useState<'none' | 'here' | 'everyone'>('none')
	const [isSending, setIsSending] = useState(false)
	const [isSavingDraft, setIsSavingDraft] = useState(false)
	const [showPreview, setShowPreview] = useState(false)
	const [timestampHelperOpen, setTimestampHelperOpen] = useState(false)
	const [timeMode, setTimeMode] = useState<TimeMode>('local')
	const [timestampInput, setTimestampInput] = useState<string>(() =>
		toDateTimeLocalValue(startOfNextHour(new Date()))
	)
	const [copiedFormat, setCopiedFormat] = useState<TimestampFormat | null>(null)
	const timestampInputRef = useRef<HTMLInputElement | null>(null)

	// Fetch all broadcast targets available to the user
	const { data: targets } = useBroadcastTargets()

	// Get the selected target to determine type
	const selectedTarget = targets?.find((t) => t.id === selectedTargetId)

	// Fetch templates scoped to the selected target/type
	const { data: templates } = useBroadcastTemplates(selectedTarget?.type, selectedTargetId || undefined)

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Get selected template object
	const selectedTemplate =
		selectedTemplateId === 'custom' ? null : templates?.find((t) => t.id === selectedTemplateId)

	// Initialize template fields when template is selected
	const handleTemplateChange = (templateId: string) => {
		setSelectedTemplateId(templateId)
		if (templateId === 'custom') {
			setTemplateFields({})
			return
		}
		const template = templates?.find((t) => t.id === templateId)
		if (template) {
			// Initialize fields with empty values
			const initialFields: Record<string, string> = {}
			template.fieldSchema.forEach((field) => {
				initialFields[field.name] = ''
			})
			setTemplateFields(initialFields)
		}
	}

	const buildBroadcastData = () => {
		if (!selectedTarget) throw new Error('No target selected')
		return {
			targetId: selectedTargetId,
			templateId: selectedTemplateId === 'custom' ? undefined : selectedTemplateId,
			title: `Broadcast to ${selectedTarget.name}`,
			content:
				selectedTemplateId === 'custom'
					? { message: customMessage, mentionLevel }
					: { ...templateFields, mentionLevel },
		}
	}

	const handleSend = async (e: React.FormEvent) => {
		e.preventDefault()
		setIsSending(true)
		try {
			const broadcast = await createBroadcast.mutateAsync(buildBroadcastData())
			await sendBroadcast.mutateAsync(broadcast.id)
			setMessage({ type: 'success', text: 'Broadcast sent successfully!' })
			setTimeout(() => navigate('/broadcasts'), 2000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to send broadcast',
			})
			setIsSending(false)
		}
	}

	const handleSaveAsDraft = async () => {
		setIsSavingDraft(true)
		try {
			const broadcast = await createBroadcast.mutateAsync(buildBroadcastData())
			setMessage({ type: 'success', text: 'Draft saved.' })
			setTimeout(() => navigate(`/broadcasts/${broadcast.id}`), 1000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to save draft',
			})
			setIsSavingDraft(false)
		}
	}

	const canSubmit =
		selectedTargetId &&
		(selectedTemplateId === 'custom' ? customMessage.trim() : selectedTemplate !== null)
	const isSubmitting = isSending || isSavingDraft

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

	const handleCopyTimestamp = async (format: TimestampFormat) => {
		if (!timestampEpoch || timestampError) return
		const token = `<t:${timestampEpoch}:${format}>`
		try {
			await navigator.clipboard.writeText(token)
			setCopiedFormat(format)
			setTimeout(() => setCopiedFormat((current) => (current === format ? null : current)), 1500)
		} catch {
			setMessage({ type: 'error', text: 'Failed to copy timestamp token' })
		}
	}

	const handleTimeModeChange = (nextMode: TimeMode) => {
		const currentParsed = parseDateTimeInput(timestampInput, timeMode)
		setTimeMode(nextMode)

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

	return (
		<Container>
			<PageHeader
				title="New Broadcast"
				description="Send a message to a broadcast target"
				action={
					<Button variant="cancel" onClick={() => navigate('/broadcasts')} size="default">
						Cancel
					</Button>
				}
			/>

			<Section>
				{/* Success/Error Message */}
				{message && (
					<Card
						className={
							message.type === 'error'
								? 'border-destructive bg-destructive/10'
								: 'border-primary bg-primary/10'
						}
					>
						<CardContent className="py-3">
							<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
								{message.text}
							</p>
						</CardContent>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Broadcast Details</CardTitle>
						<CardDescription>Configure your broadcast message</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSend} className="space-y-6">
							{/* Target Selection */}
							<div className="space-y-2">
								<Label htmlFor="target">Target *</Label>
								<Select
									inputId="target"
									value={selectedTargetId}
									onValueChange={setSelectedTargetId}
									options={
										targets?.map((target) => ({
											value: target.id,
											label: `${target.name}${
												target.description ? ` - ${target.description}` : ''
											}`,
										})) ?? []
									}
									placeholder="Select a broadcast target"
								/>
								<p className="text-xs text-muted-foreground">
									Choose where this broadcast should be sent
								</p>
							</div>

							{/* Template Selection */}
							<div className="space-y-2">
								<Label htmlFor="template">Template</Label>
								<Select
									value={selectedTemplateId}
									onValueChange={handleTemplateChange}
									inputId="template"
									options={[
										{ value: 'custom', label: 'Custom Message' },
										...(templates?.map((template) => ({
											value: template.id,
											label: template.name,
										})) ?? []),
									]}
									placeholder="Custom message"
									disabled={!selectedTargetId}
								/>
								<p className="text-xs text-muted-foreground">
									{!selectedTargetId
										? 'Select a target first'
										: 'Use a pre-configured template or write a custom message'}
								</p>
							</div>

							{/* Mention Level Selection */}
							<div className="space-y-2">
								<Label htmlFor="mentions">Mentions</Label>
								<Select
									inputId="mentions"
									value={mentionLevel}
									onValueChange={(value) => setMentionLevel(value as typeof mentionLevel)}
									options={[
										{ value: 'none', label: 'No mention' },
										{ value: 'here', label: '@here' },
										{ value: 'everyone', label: '@everyone' },
									]}
								/>
								<p className="text-xs text-muted-foreground">
									Add a mention to the beginning of the broadcast
								</p>
							</div>

							<div>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => setTimestampHelperOpen(true)}
								>
									Discord Timestamp Helper
								</Button>
							</div>

							{/* Custom Message or Template Fields */}
							{selectedTemplateId === 'custom' ? (
								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<Label htmlFor="message">Message *</Label>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => setShowPreview((v) => !v)}
										>
											{showPreview ? 'Hide Preview' : 'Show Preview'}
										</Button>
									</div>
									{showPreview ? (
										<div className="grid grid-cols-2 gap-4">
											<Textarea
												id="message"
												value={customMessage}
												onChange={(e) => setCustomMessage(e.target.value)}
												rows={10}
												placeholder="Enter your broadcast message..."
												required
												className="resize-none"
											/>
											<div className="rounded-md border border-border bg-muted/20 p-3 text-sm overflow-y-auto min-h-[160px]">
												{customMessage.trim() ? (
													renderDiscordContentValue(customMessage, 'preview')
												) : (
													<span className="text-muted-foreground italic">
														Preview will appear here…
													</span>
												)}
											</div>
										</div>
									) : (
										<Textarea
											id="message"
											value={customMessage}
											onChange={(e) => setCustomMessage(e.target.value)}
											rows={6}
											placeholder="Enter your broadcast message..."
											required
										/>
									)}
									<p className="text-xs text-muted-foreground">
										Write your custom message. Supports Discord markdown formatting.
									</p>
								</div>
							) : selectedTemplate ? (
								<div className="space-y-4">
									<div className="rounded-md bg-muted p-3">
										<Label className="text-sm font-medium">Template Preview</Label>
										<p className="text-sm text-muted-foreground mt-1">
											{selectedTemplate.messageTemplate}
										</p>
									</div>
									{selectedTemplate.fieldSchema.map((field) => (
										<div key={field.name} className="space-y-2">
											<Label htmlFor={field.name}>
												{field.label}
												{field.required && ' *'}
											</Label>
											{field.type === 'text' ? (
												<Input
													id={field.name}
													value={templateFields[field.name] || ''}
													onChange={(e) =>
														setTemplateFields({
															...templateFields,
															[field.name]: e.target.value,
														})
													}
													required={field.required}
												/>
											) : (
												<Textarea
													id={field.name}
													value={templateFields[field.name] || ''}
													onChange={(e) =>
														setTemplateFields({
															...templateFields,
															[field.name]: e.target.value,
														})
													}
													rows={4}
													required={field.required}
												/>
											)}
										</div>
									))}
								</div>
							) : null}

							{/* Submit Buttons */}
							<div className="flex justify-end gap-3 pt-4">
								<Button variant="cancel" type="button" onClick={() => navigate('/broadcasts')} disabled={isSubmitting}>
									Cancel
								</Button>
								<Button
									variant="secondary"
									type="button"
									disabled={!canSubmit || isSubmitting}
									loading={isSavingDraft}
									loadingText="Saving..."
									showIcon={false}
									onClick={handleSaveAsDraft}
								>
									Save as Draft
								</Button>
								<Button
									variant="confirm"
									type="submit"
									disabled={!canSubmit || isSubmitting}
									loading={isSending}
									loadingText="Sending..."
									showIcon={false}
								>
									Send Broadcast
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</Section>

			<Dialog open={timestampHelperOpen} onOpenChange={setTimestampHelperOpen}>
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
									onChange={(e) => setTimestampInput(e.target.value)}
								/>
							</div>
						</div>
						<p className="text-xs text-muted-foreground">
							Time Zone controls how you choose the date/time in this helper only. Discord renders
							the timestamp in each viewer&apos;s local time.
						</p>

						{timestampError ? (
							<p className="text-sm text-destructive">{timestampError}</p>
						) : timestampEpoch ? (
							<p className="text-sm text-muted-foreground">
								Epoch: <span className="font-mono">{timestampEpoch}</span>
							</p>
						) : null}

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
										{DISCORD_TIMESTAMP_FORMATS.map((item) => {
											return (
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
											)
										})}
									</tbody>
								</table>
							</div>
						</div>
					</div>

					<DialogFooter>
						<Button type="button" variant="confirm" onClick={() => setTimestampHelperOpen(false)}>
							Done
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Container>
	)
}
