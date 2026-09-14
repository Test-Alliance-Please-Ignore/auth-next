import { parseDateOrNull } from '@repo/worker-utils'

import { renderBroadcastTemplateMessage } from './message-template-renderer'

import type { BroadcastWithDetails } from '@/lib/api'

export const DISCORD_MESSAGE_MAX_LENGTH = 2000
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
		? Math.floor((parseDateOrNull(broadcast.sentAt)?.getTime() ?? Date.now()) / 1000)
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
		return stripSentFooterIfPresent(content.message.trim())
	}
	let baseMessage = broadcast.title
	if (broadcast.template?.messageTemplate) {
		baseMessage = renderBroadcastTemplateMessage(broadcast.template.messageTemplate, content, true)
	}
	return convertUnixTimestampsForPreview(baseMessage)
}

function strikethroughLines(message: string): string {
	return message
		.split('\n')
		.map((line) => (line.trim() ? `~~${line}~~` : line))
		.join('\n')
}

function renderComposedMessageForLength(args: {
	broadcast: BroadcastWithDetails
	baseMessage: string
	events: BroadcastMessageEvent[]
}): string {
	const rescindIndex = args.events.findIndex((event) => event.type === 'rescind')
	const body = rescindIndex >= 0 ? strikethroughLines(args.baseMessage) : args.baseMessage
	const sentFooter = buildSentFooter(args.broadcast)
	const parts = [`${body}\n\n${sentFooter}`]
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

/** Estimate the final Discord payload, including its canonical English metadata and markup.
 * These strings are protocol content shared with the server, not translatable UI copy.
 * A negative result means the submitted message would exceed Discord's limit.
 */
export function getBroadcastEditRemaining(
	broadcast: BroadcastWithDetails,
	type: BroadcastMessageEvent['type'],
	message: string
): number {
	const events = [
		...getMessageEvents(broadcast.content),
		{
			type,
			message: message.trim(),
			createdAtUnix: Math.floor(Date.now() / 1000),
			createdByCharacterName: broadcast.createdByCharacterName,
		},
	]
	return (
		DISCORD_MESSAGE_MAX_LENGTH -
		renderComposedMessageForLength({ broadcast, baseMessage: buildBaseMessage(broadcast), events })
			.length
	)
}
