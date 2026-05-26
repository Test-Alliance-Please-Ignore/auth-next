import { FilePlus2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { renderBroadcastTemplateMessage } from '@/features/broadcasts/message-template-renderer'
import { useAddBroadcastAddendum } from '@/hooks/useBroadcasts'

import type { BroadcastWithDetails } from '@/lib/api'

const DISCORD_MESSAGE_MAX_LENGTH = 2000
type BroadcastMessageEvent = {
	type: 'addendum' | 'rescind'
	message: string | null
	createdAtUnix: number
	createdByCharacterName: string
}

function convertUnixTimestampsForPreview(message: string): string {
	const timestampPattern = /(?<!\d)(\d{10}|\d{13})(?!\d)/g
	const minTimestamp = 946684800
	const maxTimestamp = 4102444800

	return message.replace(timestampPattern, (match) => {
		const numeric = Number.parseInt(match, 10)
		const timestamp = match.length === 13 ? Math.floor(numeric / 1000) : numeric
		if (timestamp < minTimestamp || timestamp > maxTimestamp) return match
		return `<t:${timestamp}:f>`
	})
}

function buildSentFooter(broadcast: BroadcastWithDetails): string {
	const sentUnix = broadcast.sentAt
		? Math.floor(new Date(broadcast.sentAt).getTime() / 1000)
		: Math.floor(Date.now() / 1000)
	return `#### SENT BY ${broadcast.createdByCharacterName} to ${broadcast.target.name} @ <t:${sentUnix}:F> ####`
}

function getMessageEvents(content: Record<string, unknown>): BroadcastMessageEvent[] {
	const raw = content.__messageEvents
	if (!Array.isArray(raw)) return []
	return raw
		.filter((item): item is BroadcastMessageEvent => {
			if (typeof item !== 'object' || item === null) return false
			const record = item as Record<string, unknown>
			if (record.type !== 'addendum' && record.type !== 'rescind') return false
			if (record.message !== null && typeof record.message !== 'string') return false
			if (typeof record.createdAtUnix !== 'number') return false
			if (typeof record.createdByCharacterName !== 'string') return false
			return true
		})
		.sort((a, b) => a.createdAtUnix - b.createdAtUnix)
}

function stripSentFooterIfPresent(message: string): string {
	const lines = message.split('\n')
	let index = lines.length - 1
	while (index >= 0 && lines[index].trim() === '') {
		index -= 1
	}
	if (index < 0 || !lines[index].includes('#### SENT BY ')) return message
	const baseLines = lines.slice(0, index)
	while (baseLines.length > 0 && baseLines[baseLines.length - 1].trim() === '') {
		baseLines.pop()
	}
	return baseLines.join('\n')
}

function buildBaseMessage(broadcast: BroadcastWithDetails): string {
	const content = broadcast.content as Record<string, string | undefined>
	const explicitBase =
		typeof (broadcast.content as Record<string, unknown>).__baseMessage === 'string'
			? String((broadcast.content as Record<string, unknown>).__baseMessage).trim()
			: ''
	if (explicitBase) return explicitBase
	if (typeof content.message === 'string' && content.message.trim().length > 0) {
		return stripSentFooterIfPresent(content.message)
	}
	let baseMessage = broadcast.title
	if (broadcast.template?.messageTemplate) {
		baseMessage = renderBroadcastTemplateMessage(broadcast.template.messageTemplate, content, true)
	}
	return convertUnixTimestampsForPreview(baseMessage)
}

function renderComposedMessageForLength(args: {
	broadcast: BroadcastWithDetails
	baseMessage: string
	events: BroadcastMessageEvent[]
}): string {
	const sentFooter = buildSentFooter(args.broadcast)
	const parts = [`${args.baseMessage}\n\n${sentFooter}`]
	for (const event of args.events) {
		if (event.type === 'addendum') {
			const addendumMessage = event.message?.trim() ?? ''
			if (!addendumMessage) continue
			parts.push(
				`ADDENDUM: ${addendumMessage}\n\n#### ADDENDUM BY ${event.createdByCharacterName} @ <t:${event.createdAtUnix}:F> ####`
			)
			continue
		}
		let rescindBlock = ''
		const rescindMessage = event.message?.trim() ?? ''
		if (rescindMessage) rescindBlock += `RESCINDED: ${rescindMessage}\n\n`
		rescindBlock += `#### RESCINDED @ <t:${event.createdAtUnix}:F> ####`
		parts.push(rescindBlock)
	}
	return parts.join('\n\n')
}

interface AddBroadcastAddendumDialogProps {
	broadcast?: BroadcastWithDetails
	broadcastId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
	onError?: (error: Error) => void
}

export function AddBroadcastAddendumDialog({
	broadcast,
	broadcastId,
	open,
	onOpenChange,
	onSuccess,
	onError,
}: AddBroadcastAddendumDialogProps) {
	const addendum = useAddBroadcastAddendum()
	const [addendumMessage, setAddendumMessage] = useState('')
	const remaining =
		broadcast
			? (() => {
					const addendumTimestamp = Math.floor(Date.now() / 1000)
					const baseMessage = buildBaseMessage(broadcast)
					const existingEvents = getMessageEvents(broadcast.content as Record<string, unknown>)
					const nextEvents: BroadcastMessageEvent[] = [
						...existingEvents,
						{
							type: 'addendum',
							message: '',
							createdAtUnix: addendumTimestamp,
							createdByCharacterName: broadcast.createdByCharacterName,
						},
					]
					const fixedLength = renderComposedMessageForLength({
						broadcast,
						baseMessage,
						events: nextEvents,
					}).length
					return Math.max(
						0,
						DISCORD_MESSAGE_MAX_LENGTH - fixedLength - addendumMessage.trim().length
					)
				})()
			: null

	const handleClose = () => {
		onOpenChange(false)
		setAddendumMessage('')
	}

	const handleConfirm = async () => {
		try {
			await addendum.mutateAsync({
				id: broadcastId,
				addendumMessage: addendumMessage.trim(),
			})
			handleClose()
			onSuccess?.()
		} catch (error) {
			handleClose()
			onError?.(error instanceof Error ? error : new Error('Failed to add broadcast addendum'))
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add Broadcast Addendum</DialogTitle>
					<DialogDescription>
						This will edit the Discord message by appending a dated addendum block.
					</DialogDescription>
				</DialogHeader>
				<div className="py-2">
					<label className="text-sm font-medium mb-1 block">Addendum message</label>
					<Textarea
						placeholder="Enter the addendum text to append..."
						value={addendumMessage}
						onChange={(e) => setAddendumMessage(e.target.value)}
						rows={4}
						disabled={addendum.isPending}
						maxLength={remaining ?? undefined}
					/>
					{remaining !== null ? (
						<p className="text-xs mt-1">
							<span className={remaining === 0 ? 'text-destructive' : 'text-muted-foreground'}>
								{remaining} characters remaining
							</span>
						</p>
					) : null}
					<p className="text-xs text-muted-foreground mt-1">
						This is required and will be appended with timestamp metadata.
					</p>
				</div>
				<DialogFooter>
					<Button variant="cancel" onClick={handleClose} disabled={addendum.isPending}>
						Cancel
					</Button>
					<Button
						variant="confirm"
						onClick={handleConfirm}
						disabled={addendumMessage.trim().length === 0 || remaining === 0}
						loading={addendum.isPending}
						loadingText="Adding..."
						showIcon={false}
					>
						<FilePlus2 className="h-4 w-4" />
						Add Addendum
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
