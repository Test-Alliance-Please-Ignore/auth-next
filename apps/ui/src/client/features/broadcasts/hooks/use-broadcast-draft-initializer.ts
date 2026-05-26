import { useEffect } from 'react'

import type { BroadcastWithDetails } from '@/lib/api'

interface UseBroadcastDraftInitializerArgs {
	isEditMode: boolean
	draftBroadcast: BroadcastWithDetails | null | undefined
	isDraftInitialized: boolean
	setIsDraftInitialized: (value: boolean) => void
	setMessage: (value: { type: 'success' | 'error'; text: string } | null) => void
	setSelectedTargetId: (value: string) => void
	setSelectedTemplateId: (value: string) => void
	setMentionLevel: (value: 'none' | 'here' | 'everyone') => void
	setTemplateFields: (value: Record<string, string>) => void
	setMessageParts: (value: { prefix: string; suffix: string }) => void
	setTemplateFieldSelections: (value: Record<string, string>) => void
	setCustomMessage: (value: string) => void
}

export function useBroadcastDraftInitializer({
	isEditMode,
	draftBroadcast,
	isDraftInitialized,
	setIsDraftInitialized,
	setMessage,
	setSelectedTargetId,
	setSelectedTemplateId,
	setMentionLevel,
	setTemplateFields,
	setMessageParts,
	setTemplateFieldSelections,
	setCustomMessage,
}: UseBroadcastDraftInitializerArgs): void {
	useEffect(() => {
		if (!isEditMode || !draftBroadcast || isDraftInitialized) return

		if (draftBroadcast.status !== 'draft') {
			setMessage({ type: 'error', text: 'Only draft broadcasts can be edited.' })
			setIsDraftInitialized(true)
			return
		}

		setSelectedTargetId(draftBroadcast.targetId)
		setSelectedTemplateId(draftBroadcast.templateId ?? 'custom')
		const nextMentionLevel =
			draftBroadcast.content.mentionLevel === 'here' ||
			draftBroadcast.content.mentionLevel === 'everyone' ||
			draftBroadcast.content.mentionLevel === 'none'
				? (draftBroadcast.content.mentionLevel as 'here' | 'everyone' | 'none')
				: 'here'
		setMentionLevel(nextMentionLevel)

		if (draftBroadcast.templateId) {
			const nextTemplateFields: Record<string, string> = {}
			for (const [key, value] of Object.entries(draftBroadcast.content)) {
				if (key === 'mentionLevel' || key === '__defaultText' || key === '__prefixText') continue
				nextTemplateFields[key] = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
			}
			setTemplateFields(nextTemplateFields)
			setMessageParts({
				prefix:
					typeof draftBroadcast.content.__prefixText === 'string'
						? draftBroadcast.content.__prefixText
						: '',
				suffix:
					typeof draftBroadcast.content.__defaultText === 'string'
						? draftBroadcast.content.__defaultText
						: '',
			})
			setTemplateFieldSelections({})
			setCustomMessage('')
		} else {
			const messageValue = draftBroadcast.content.message
			setCustomMessage(typeof messageValue === 'string' ? messageValue : '')
			setTemplateFields({})
			setMessageParts({ prefix: '', suffix: '' })
			setTemplateFieldSelections({})
		}

		setIsDraftInitialized(true)
	}, [
		draftBroadcast,
		isDraftInitialized,
		isEditMode,
		setCustomMessage,
		setIsDraftInitialized,
		setMentionLevel,
		setMessage,
		setMessageParts,
		setSelectedTargetId,
		setSelectedTemplateId,
		setTemplateFieldSelections,
		setTemplateFields,
	])
}
