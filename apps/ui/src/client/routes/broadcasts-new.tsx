import { Copy } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { parseBroadcastSrpMode } from '@repo/broadcasts'

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
	useBroadcast,
	useBroadcastTemplates,
	useCreateBroadcast,
	useSendBroadcast,
	useUpdateBroadcast,
} from '@/hooks/useBroadcasts'
import { useAuth } from '@/hooks/useAuth'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useDoctrines, useStagingSystems } from '@/features/doctrines/hooks'
import {
	DOCTRINE_READ_MOTD_VALUE,
	getInitialDoctrineFieldState,
	resolveDoctrineSelectionFromValue,
	SystemDoctrineField,
} from '@/features/broadcasts/components/system-doctrine-field'
import { SystemFleetTrackingField } from '@/features/broadcasts/components/system-fleet-tracking-field'
import {
	FLEET_COMMANDER_CUSTOM_VALUE,
	SystemFleetCommanderField,
} from '@/features/broadcasts/components/system-fleet-commander-field'
import { SystemFrogsirenField } from '@/features/broadcasts/components/system-frogsiren-field'
import { SystemSrpField } from '@/features/broadcasts/components/system-srp-field'
import { generateSrpTokenAtFormLoad } from '@/features/broadcasts/srp-token-generator'
import {
	getInitialStagingFieldState,
	resolveStagingSelectionFromValue,
	STAGING_CUSTOM_VALUE,
	SystemStagingField,
} from '@/features/broadcasts/components/system-staging-field'
import { renderBroadcastTemplateMessage } from '@/features/broadcasts/message-template-renderer'

import type { BroadcastTemplate } from '@/lib/api'

type TimeMode = 'local' | 'eve'
type TimestampFormat = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R'
const DISCORD_MESSAGE_MAX_LENGTH = 2000
const FROGSIREN_EMOTE = '<:fs:1496199804470952080>'

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

function parseBooleanField(value: string | undefined, defaultValue: boolean): boolean {
	if (typeof value !== 'string') return defaultValue
	const normalized = value.trim().toLowerCase()
	if (!normalized) return defaultValue
	if (['true', '1', 'yes', 'enabled', 'on'].includes(normalized)) return true
	if (['false', '0', 'no', 'disabled', 'off'].includes(normalized)) return false
	return defaultValue
}

export function resolveFleetCommanderSelectionFromFields(args: {
	characters: Array<{ characterId: string; characterName: string; hasValidToken: boolean }>
	mainCharacterId?: string | null
	value: string
	characterId: string
}): { selection: string; value: string; trackingCharacterId: string; trackingCharacterName: string } {
	const validCharacters = args.characters.filter((character) => character.hasValidToken)
	const selectedById = validCharacters.find((character) => character.characterId === args.characterId)
	if (selectedById) {
		return {
			selection: selectedById.characterId,
			value: selectedById.characterName,
			trackingCharacterId: selectedById.characterId,
			trackingCharacterName: selectedById.characterName,
		}
	}

	const selectedByName = validCharacters.find((character) => character.characterName === args.value)
	if (selectedByName) {
		return {
			selection: selectedByName.characterId,
			value: selectedByName.characterName,
			trackingCharacterId: selectedByName.characterId,
			trackingCharacterName: selectedByName.characterName,
		}
	}
	if ((args.value ?? '').trim().length > 0) {
		return {
			selection: FLEET_COMMANDER_CUSTOM_VALUE,
			value: args.value,
			trackingCharacterId: '',
			trackingCharacterName: '',
		}
	}

	const mainCharacter = validCharacters.find(
		(character) => character.characterId === (args.mainCharacterId ?? '')
	)
	if (mainCharacter) {
		return {
			selection: mainCharacter.characterId,
			value: mainCharacter.characterName,
			trackingCharacterId: mainCharacter.characterId,
			trackingCharacterName: mainCharacter.characterName,
		}
	}

	const firstCharacter = validCharacters[0]
	if (firstCharacter) {
		return {
			selection: firstCharacter.characterId,
			value: firstCharacter.characterName,
			trackingCharacterId: firstCharacter.characterId,
			trackingCharacterName: firstCharacter.characterName,
		}
	}

	return {
		selection: FLEET_COMMANDER_CUSTOM_VALUE,
		value: args.value,
		trackingCharacterId: '',
		trackingCharacterName: '',
	}
}

function wrapWithFrogsirenBanner(message: string): string {
	const banner = Array.from({ length: 16 }, () => FROGSIREN_EMOTE).join(' ')
	return `${banner}\n\n${message}\n\n${banner}`
}

function convertUnixTimestampsForPreview(message: string, format: string = 'f'): string {
	const timestampPattern = /(?<!\d)(\d{10}|\d{13})(?!\d)/g
	const minTimestamp = 946684800
	const maxTimestamp = 4102444800

	return message.replace(timestampPattern, (match) => {
		const numeric = Number.parseInt(match, 10)
		const timestamp = match.length === 13 ? Math.floor(numeric / 1000) : numeric
		if (timestamp < minTimestamp || timestamp > maxTimestamp) return match
		return `<t:${timestamp}:${format}>`
	})
}

function autoResizeTextarea(element: HTMLTextAreaElement): void {
	element.style.height = '0px'
	element.style.height = `${element.scrollHeight}px`
}

export default function NewBroadcastPage() {
	const [searchParams] = useSearchParams()
	const draftId = searchParams.get('draftId') ?? ''
	const isEditMode = draftId.length > 0
	usePageTitle(isEditMode ? 'Edit Draft Broadcast' : 'New Broadcast')
	const navigate = useNavigate()
	const createBroadcast = useCreateBroadcast()
	const sendBroadcast = useSendBroadcast()
	const updateBroadcast = useUpdateBroadcast()
	const { user } = useAuth()
	const { hasPermission, isAdmin } = useUserPermissions()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const { data: draftBroadcast, isLoading: draftLoading } = useBroadcast(draftId)

	// Form state
	const [selectedTargetId, setSelectedTargetId] = useState<string>('')
	const [selectedTemplateId, setSelectedTemplateId] = useState<string>('custom')
	const [customMessage, setCustomMessage] = useState<string>('')
	const [templateFields, setTemplateFields] = useState<Record<string, string>>({})
	const [templateFieldSelections, setTemplateFieldSelections] = useState<Record<string, string>>({})
	const [templatePrefixText, setTemplatePrefixText] = useState<string>('')
	const [templateDefaultText, setTemplateDefaultText] = useState<string>('')
	const [mentionLevel, setMentionLevel] = useState<'none' | 'here' | 'everyone'>('here')
	const [isSending, setIsSending] = useState(false)
	const [isSavingDraft, setIsSavingDraft] = useState(false)
	const [timestampHelperOpen, setTimestampHelperOpen] = useState(false)
	const [timeMode, setTimeMode] = useState<TimeMode>('local')
	const [timestampInput, setTimestampInput] = useState<string>(() =>
		toDateTimeLocalValue(startOfNextHour(new Date()))
	)
	const [copiedFormat, setCopiedFormat] = useState<TimestampFormat | null>(null)
	const timestampInputRef = useRef<HTMLInputElement | null>(null)
	const [isDraftInitialized, setIsDraftInitialized] = useState(false)
	const autoSelectedTemplateTargetsRef = useRef<Set<string>>(new Set())

	// Fetch all broadcast targets available to the user
	const { data: targets } = useBroadcastTargets()

	// Get the selected target to determine type
	const selectedTarget = targets?.find((t) => t.id === selectedTargetId)

	// Fetch templates scoped to the selected target/type
	const { data: templates } = useBroadcastTemplates(selectedTarget?.type, selectedTargetId || undefined)
	const { data: doctrines = [] } = useDoctrines()
	const { data: stagingSystems = [] } = useStagingSystems()

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

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
			setTemplatePrefixText(
				typeof draftBroadcast.content.__prefixText === 'string'
					? draftBroadcast.content.__prefixText
					: ''
			)
			setTemplateDefaultText(
				typeof draftBroadcast.content.__defaultText === 'string'
					? draftBroadcast.content.__defaultText
					: ''
			)
			setTemplateFieldSelections({})
			setCustomMessage('')
		} else {
			const messageValue = draftBroadcast.content.message
			setCustomMessage(typeof messageValue === 'string' ? messageValue : '')
			setTemplateFields({})
			setTemplatePrefixText('')
			setTemplateDefaultText('')
			setTemplateFieldSelections({})
		}

		setIsDraftInitialized(true)
	}, [draftBroadcast, isDraftInitialized, isEditMode])

	// Get selected template object
	const selectedTemplate =
		selectedTemplateId === 'custom' ? null : templates?.find((t) => t.id === selectedTemplateId)
	const canCreateFleetTracking = isAdmin || hasPermission('urn:fleet-tracking:create')
	const senderCharacterName =
		user?.characters.find((character) => character.characterId === user.mainCharacterId)?.characterName ??
		'Unknown Sender'
	const renderedOutboundMessage = useMemo(() => {
		if (!selectedTarget) return ''

		let message = ''
		if (selectedTemplate) {
			message = [
				templatePrefixText.trim(),
				renderBroadcastTemplateMessage(selectedTemplate.messageTemplate, templateFields, true),
				templateDefaultText.trim(),
			]
				.filter(Boolean)
				.join('\n\n')
		} else {
			message = customMessage
		}

		message = convertUnixTimestampsForPreview(message)

		if (mentionLevel === 'here') {
			message = `@here\n\n${message}`
		} else if (mentionLevel === 'everyone') {
			message = `@everyone\n\n${message}`
		}

		if (parseBooleanField(templateFields.__frogsirenEnabled, false)) {
			message = wrapWithFrogsirenBanner(message)
		}

		const unixTimestamp = Math.floor(Date.now() / 1000)
		const footer = `\n\n#### SENT BY ${senderCharacterName} to ${selectedTarget.name} @ <t:${unixTimestamp}:F> ####`
		return `${message}${footer}`
	}, [
		customMessage,
		mentionLevel,
		selectedTarget,
		selectedTemplate,
		senderCharacterName,
		templateDefaultText,
		templateFields,
		templatePrefixText,
	])
	const renderedOutboundLength = renderedOutboundMessage.length
	const isOverRenderedMessageLimit = renderedOutboundLength > DISCORD_MESSAGE_MAX_LENGTH
	// Initialize template fields when template is selected
	const handleTemplateChange = useCallback((templateId: string) => {
		setSelectedTemplateId(templateId)
		if (templateId === 'custom') {
			setTemplateFields({})
			setTemplatePrefixText('')
			setTemplateDefaultText('')
			setTemplateFieldSelections({})
			return
		}
		const template = templates?.find((t) => t.id === templateId)
		if (template) {
			// Initialize fields with empty values
			const initialFields: Record<string, string> = {}
			const initialSelections: Record<string, string> = {}
			template.fieldSchema.forEach((field) => {
				if (field.type === 'system_doctrine') {
					const doctrineState = getInitialDoctrineFieldState()
					initialSelections[field.name] = doctrineState.selection
					initialFields[field.name] = doctrineState.value
					initialFields.__doctrineId = ''
					return
				}

				if (field.type === 'system_staging') {
					const stagingState = getInitialStagingFieldState(stagingSystems)
					initialSelections[field.name] = stagingState.selection
					initialFields[field.name] = stagingState.value
					return
				}

				if (field.type === 'select') {
					const firstOption = field.options?.[0] ?? ''
					initialSelections[field.name] = firstOption
					initialFields[field.name] = firstOption
					return
				}

				if (field.type === 'system_srp') {
					initialFields[field.name] = 'blanket'
					initialFields.__srpToken = generateSrpTokenAtFormLoad()
					return
				}

				if (field.type === 'system_frogsiren') {
					initialFields[field.name] = 'false'
					return
				}

				if (field.type === 'system_fleet_tracking') {
					initialFields.__fleetTrackingEnabled = 'false'
					initialFields.__fleetTrackingCharacterId = ''
					initialFields.__fleetTrackingCharacterName = ''
					return
				}

				if (field.type === 'system_fleet_commander') {
					const fleetCommanderState = resolveFleetCommanderSelectionFromFields({
						characters: user?.characters ?? [],
						mainCharacterId: user?.mainCharacterId,
						value: '',
						characterId: '',
					})
					initialSelections[field.name] = fleetCommanderState.selection
					initialFields[field.name] = fleetCommanderState.value
					initialFields.__fleetTrackingCharacterId = fleetCommanderState.trackingCharacterId
					initialFields.__fleetTrackingCharacterName = fleetCommanderState.trackingCharacterName
					return
				}

				initialFields[field.name] = ''
			})
			setTemplateFields(initialFields)
			setTemplateFieldSelections(initialSelections)
			setTemplatePrefixText('')
			setTemplateDefaultText('')
		}
	}, [stagingSystems, templates, user?.characters, user?.mainCharacterId])

	const updateTemplateField = (fieldName: string, value: string) => {
		setTemplateFields((current) => ({
			...current,
			[fieldName]: value,
		}))
	}

	const updateTemplateFieldSelection = (fieldName: string, value: string) => {
		setTemplateFieldSelections((current) => ({
			...current,
			[fieldName]: value,
		}))
	}

	useEffect(() => {
		if (!selectedTemplate) return
		for (const field of selectedTemplate.fieldSchema) {
			const element = document.getElementById(field.name)
			if (element instanceof HTMLTextAreaElement) {
				autoResizeTextarea(element)
			}
		}
		const prefix = document.getElementById('template-prefix-text')
		if (prefix instanceof HTMLTextAreaElement) {
			autoResizeTextarea(prefix)
		}
		const suffix = document.getElementById('template-default-text')
		if (suffix instanceof HTMLTextAreaElement) {
			autoResizeTextarea(suffix)
		}
	}, [selectedTemplate, templateFields])

	useEffect(() => {
		if (!selectedTemplate) return

		const nextSelections: Record<string, string> = { ...templateFieldSelections }
		let changed = false
		for (const field of selectedTemplate.fieldSchema) {
			if (nextSelections[field.name]) continue

			if (field.type === 'system_doctrine') {
				const doctrineState = resolveDoctrineSelectionFromValue(templateFields[field.name])
				nextSelections[field.name] = doctrineState.selection
				if ((templateFields[field.name] ?? '') !== doctrineState.value) {
					updateTemplateField(field.name, doctrineState.value)
				}
				const matchedDoctrine = doctrines.find((doctrine) => doctrine.name === doctrineState.value)
				const nextDoctrineId = matchedDoctrine?.id ?? ''
				if ((templateFields.__doctrineId ?? '') !== nextDoctrineId) {
					updateTemplateField('__doctrineId', nextDoctrineId)
				}
				changed = true
				continue
			}

			if (field.type === 'system_staging') {
				const stagingState = resolveStagingSelectionFromValue(templateFields[field.name])
				nextSelections[field.name] = stagingState.selection
				if ((templateFields[field.name] ?? '') !== stagingState.value) {
					updateTemplateField(field.name, stagingState.value)
				}
				changed = true
				continue
			}

			if (field.type === 'select') {
				const currentValue = (templateFields[field.name] ?? '').trim()
				const firstOption = field.options?.[0] ?? ''
				nextSelections[field.name] = currentValue.length > 0 ? currentValue : firstOption
				if (!currentValue && firstOption) {
					updateTemplateField(field.name, firstOption)
				}
				changed = true
				continue
			}

				if (field.type === 'system_srp') {
					const currentValue = templateFields[field.name]
					if (currentValue === undefined || currentValue.trim().length === 0) {
						updateTemplateField(field.name, 'blanket')
						changed = true
					}
					const mode = parseBroadcastSrpMode(currentValue)
				const currentToken = (templateFields.__srpToken ?? '').trim()
				if (mode !== 'disabled' && currentToken.length === 0) {
					updateTemplateField('__srpToken', generateSrpTokenAtFormLoad())
					changed = true
				}
				if (mode === 'disabled' && currentToken.length > 0) {
					updateTemplateField('__srpToken', '')
					changed = true
				}
				continue
			}

			if (field.type === 'system_frogsiren') {
				const currentValue = templateFields[field.name]
				if (currentValue === undefined || currentValue.trim().length === 0) {
					updateTemplateField(field.name, 'false')
					changed = true
				}
			}

			if (field.type === 'system_fleet_tracking') {
				if (templateFields.__fleetTrackingEnabled === undefined) {
					updateTemplateField('__fleetTrackingEnabled', 'false')
					changed = true
				}
				if (templateFields.__fleetTrackingCharacterId === undefined) {
					updateTemplateField('__fleetTrackingCharacterId', '')
					changed = true
				}
				if (templateFields.__fleetTrackingCharacterName === undefined) {
					updateTemplateField('__fleetTrackingCharacterName', '')
					changed = true
				}
			}

			if (field.type === 'system_fleet_commander') {
				const fleetCommanderState = resolveFleetCommanderSelectionFromFields({
					characters: user?.characters ?? [],
					mainCharacterId: user?.mainCharacterId,
					value: templateFields[field.name] ?? '',
					characterId: templateFields.__fleetTrackingCharacterId ?? '',
				})
				if ((templateFieldSelections[field.name] ?? '') !== fleetCommanderState.selection) {
					nextSelections[field.name] = fleetCommanderState.selection
					changed = true
				}
				if ((templateFields[field.name] ?? '') !== fleetCommanderState.value) {
					updateTemplateField(field.name, fleetCommanderState.value)
					changed = true
				}
				if (
					(templateFields.__fleetTrackingCharacterId ?? '') !==
					fleetCommanderState.trackingCharacterId
				) {
					updateTemplateField(
						'__fleetTrackingCharacterId',
						fleetCommanderState.trackingCharacterId
					)
					changed = true
				}
				if (
					(templateFields.__fleetTrackingCharacterName ?? '') !==
					fleetCommanderState.trackingCharacterName
				) {
					updateTemplateField(
						'__fleetTrackingCharacterName',
						fleetCommanderState.trackingCharacterName
					)
					changed = true
				}
				if (
					fleetCommanderState.selection === FLEET_COMMANDER_CUSTOM_VALUE &&
					parseBooleanField(templateFields.__fleetTrackingEnabled, false)
				) {
					updateTemplateField('__fleetTrackingEnabled', 'false')
					changed = true
				}
			}
		}

		if (changed) {
			setTemplateFieldSelections(nextSelections)
		}
	}, [
		doctrines,
		selectedTemplate,
		templateFieldSelections,
		templateFields,
		user?.characters,
		user?.mainCharacterId,
	])

	useEffect(() => {
		if (isEditMode || !selectedTargetId || !templates || templates.length === 0) return

		if (
			selectedTemplateId === 'custom' &&
			!autoSelectedTemplateTargetsRef.current.has(selectedTargetId)
		) {
			autoSelectedTemplateTargetsRef.current.add(selectedTargetId)
			handleTemplateChange(templates[0]!.id)
			return
		}

		const hasValidSelection =
			selectedTemplateId === 'custom' ||
			templates.some((template) => template.id === selectedTemplateId)
		if (hasValidSelection) return

		handleTemplateChange(templates[0]!.id)
	}, [handleTemplateChange, isEditMode, selectedTargetId, selectedTemplateId, templates])

	useEffect(() => {
		if (canCreateFleetTracking) return
		if ((templateFields.__fleetTrackingEnabled ?? '').toLowerCase() !== 'true') return
		updateTemplateField('__fleetTrackingEnabled', 'false')
	}, [canCreateFleetTracking, templateFields.__fleetTrackingEnabled])

	const buildBroadcastData = () => {
		if (!selectedTarget) throw new Error('No target selected')
		return {
			targetId: selectedTargetId,
			templateId: selectedTemplateId === 'custom' ? undefined : selectedTemplateId,
			title: `Broadcast to ${selectedTarget.name}`,
			content:
				selectedTemplateId === 'custom'
					? { message: customMessage, mentionLevel }
					: {
							...templateFields,
							__prefixText: templatePrefixText,
							__defaultText: templateDefaultText,
							mentionLevel,
						},
		}
	}

	const handleSend = async (e: React.FormEvent) => {
		e.preventDefault()
		if (isOverRenderedMessageLimit) {
			setMessage({
				type: 'error',
				text: `Rendered broadcast is ${renderedOutboundLength} characters. Discord maximum is ${DISCORD_MESSAGE_MAX_LENGTH}.`,
			})
			return
		}
		if (isEditMode && draftBroadcast?.status !== 'draft') {
			setMessage({ type: 'error', text: 'Only draft broadcasts can be edited.' })
			return
		}
		setIsSending(true)
		try {
			const payload = buildBroadcastData()
			const broadcast = isEditMode
				? await updateBroadcast.mutateAsync({
						id: draftId,
						data: {
							content: payload.content,
						},
					})
				: await createBroadcast.mutateAsync(payload)
			const sendResult = await sendBroadcast.mutateAsync(isEditMode ? draftId : broadcast.id)
			if (!sendResult.success) {
				const errorText =
					sendResult.delivery.errorMessage || 'Failed to send broadcast'
				throw new Error(errorText)
			}

			// Fleet-tracking side effect: if the broadcast started a session, redirect
			// to it. If the broadcast asked for tracking but it failed, surface the
			// reason and stay on this page so the user can investigate.
			if (sendResult.trackingSessionId) {
				setMessage({
					type: 'success',
					text: 'Broadcast sent — opening tracking session…',
				})
				setTimeout(
					() => navigate(`/fleet-tracking/${sendResult.trackingSessionId}`),
					1200
				)
				return
			}
			if (sendResult.trackingError) {
				setMessage({
					type: 'error',
					text: `Broadcast sent, but fleet tracking failed: ${sendResult.trackingError}`,
				})
				setIsSending(false)
				return
			}

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
		if (isEditMode && draftBroadcast?.status !== 'draft') {
			setMessage({ type: 'error', text: 'Only draft broadcasts can be edited.' })
			return
		}
		setIsSavingDraft(true)
		try {
			const payload = buildBroadcastData()
			const broadcast = isEditMode
				? await updateBroadcast.mutateAsync({
						id: draftId,
						data: {
							content: payload.content,
						},
					})
				: await createBroadcast.mutateAsync(payload)
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
		(selectedTemplateId === 'custom' ? customMessage.trim() : selectedTemplate !== null) &&
		(!isEditMode || draftBroadcast?.status === 'draft')
	const isSubmitting = isSending || isSavingDraft || updateBroadcast.isPending

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
				title={isEditMode ? 'Edit Draft Broadcast' : 'New Broadcast'}
				description={
					isEditMode
						? 'Update this draft before sending'
						: 'Send a message to a broadcast target'
				}
				action={
					<Button variant="cancel" onClick={() => navigate('/broadcasts')} size="default">
						Cancel
					</Button>
				}
			/>

			<Section>
				{/* Success/Error Message */}
				{isEditMode && draftLoading && (
					<Card>
						<CardContent className="py-3 text-sm text-muted-foreground">
							Loading draft...
						</CardContent>
					</Card>
				)}
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
							<div className="grid gap-4 lg:grid-cols-3">
								{/* Target Selection */}
								<div className="space-y-2">
									<Label htmlFor="target">Target *</Label>
									<Select
										inputId="target"
										value={selectedTargetId}
										onValueChange={setSelectedTargetId}
										searchable
										options={
											targets?.map((target) => ({
												value: target.id,
												label: `${target.name}${
													target.description ? ` - ${target.description}` : ''
												}`,
											})) ?? []
										}
										placeholder="Select a broadcast target"
										disabled={isEditMode}
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
										disabled={!selectedTargetId || isEditMode}
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
								<div className="grid gap-4 [grid-template-areas:'preview''form'] lg:[grid-template-areas:'form_preview'] lg:grid-cols-2 lg:items-stretch">
									<div className="[grid-area:preview] space-y-2 lg:self-stretch">
										<Label className="text-sm font-medium">Preview</Label>
										<div className="rounded-md border border-border bg-muted/20 p-3 text-sm overflow-y-auto min-h-[16rem] h-full">
											{customMessage.trim() ? (
												renderDiscordContentValue(customMessage, 'preview')
											) : (
												<span className="text-muted-foreground italic">
													Preview will appear here…
												</span>
											)}
										</div>
									</div>
									<div className="[grid-area:form] space-y-2">
										<Label htmlFor="message">Message *</Label>
										<Textarea
											id="message"
											value={customMessage}
											onChange={(e) => setCustomMessage(e.target.value)}
											rows={10}
											placeholder="Enter your broadcast message..."
											required
											className="resize-none h-[16rem]"
										/>
										<p className="text-xs text-muted-foreground">
											Write your custom message. Supports Discord markdown formatting.
										</p>
									</div>
								</div>
							) : selectedTemplate ? (
								<div className="grid gap-4 [grid-template-areas:'preview''form'] lg:[grid-template-areas:'form_preview'] lg:grid-cols-2 lg:items-stretch">
									<div className="[grid-area:preview] space-y-2 lg:self-stretch">
										<Label className="text-sm font-medium">Preview</Label>
										<div className="rounded-md border border-border bg-muted/20 p-3 text-sm overflow-y-auto min-h-[16rem] h-full">
											{renderedOutboundMessage.trim() ? (
												renderDiscordContentValue(renderedOutboundMessage, 'preview')
											) : (
												<span className="text-muted-foreground italic">
													Preview will appear here…
												</span>
											)}
										</div>
									</div>
									<div className="[grid-area:form] space-y-4">
										<div className="max-w-xl space-y-2">
											<Label htmlFor="template-prefix-text">Text before (optional)</Label>
											<Textarea
												id="template-prefix-text"
												value={templatePrefixText}
												onChange={(e) => {
													autoResizeTextarea(e.currentTarget)
													setTemplatePrefixText(e.target.value)
												}}
												rows={1}
												placeholder="Optional text prepended before the template message"
												className="resize-none overflow-hidden"
												style={{ minHeight: '2.5rem' }}
											/>
										</div>

										<Label className="text-sm font-medium">Template Fields</Label>
										<div className="grid gap-4 md:grid-cols-2">
											{selectedTemplate.fieldSchema
												.filter(
													(field) =>
														field.type !== 'system_frogsiren' &&
														field.type !== 'system_fleet_tracking'
												)
												.map((field) => (
													<div key={field.name} className="space-y-2 min-w-0">
														{field.type === 'system_srp' ? (
															<SystemSrpField
																fieldName={field.name}
																value={templateFields[field.name]}
																onModeChange={(mode) => {
																	updateTemplateField(field.name, mode)
																	if (mode === 'disabled') {
																		updateTemplateField('__srpToken', '')
																		return
																	}
																	if (
																		(templateFields.__srpToken ?? '').trim().length === 0
																	) {
																		updateTemplateField(
																			'__srpToken',
																			generateSrpTokenAtFormLoad()
																		)
																	}
																}}
															/>
														) : field.type === 'system_doctrine' ? (
															<SystemDoctrineField
																fieldName={field.name}
																fieldLabel={field.label}
																required={field.required}
																selection={
																	templateFieldSelections[field.name] ??
																	DOCTRINE_READ_MOTD_VALUE
																}
																value={templateFields[field.name]}
																doctrines={doctrines}
																	onSelectionChange={(value) => {
																		updateTemplateFieldSelection(field.name, value)
																		const matchedDoctrine = doctrines.find(
																			(doctrine) => doctrine.name === value
																		)
																		updateTemplateField('__doctrineId', matchedDoctrine?.id ?? '')
																	}}
																onValueChange={(value) => {
																	updateTemplateField(field.name, value)
																	const matchedDoctrine = doctrines.find(
																		(doctrine) => doctrine.name === value
																	)
																	updateTemplateField('__doctrineId', matchedDoctrine?.id ?? '')
																}}
															/>
														) : field.type === 'system_staging' ? (
															<SystemStagingField
																fieldName={field.name}
																fieldLabel={field.label}
																required={field.required}
																selection={
																	templateFieldSelections[field.name] ??
																	STAGING_CUSTOM_VALUE
																}
																value={templateFields[field.name]}
																stagingSystems={stagingSystems}
																onSelectionChange={(value) =>
																	updateTemplateFieldSelection(field.name, value)
																}
																onValueChange={(value) =>
																	updateTemplateField(field.name, value)
																}
															/>
														) : field.type === 'system_fleet_commander' ? (
															<SystemFleetCommanderField
																fieldName={field.name}
																fieldLabel={field.label}
																required={field.required}
																selection={
																	templateFieldSelections[field.name] ??
																	FLEET_COMMANDER_CUSTOM_VALUE
																}
																value={templateFields[field.name] ?? ''}
																characters={(user?.characters ?? [])
																	.filter((character) => character.hasValidToken)
																	.map((character) => ({
																		characterId: character.characterId,
																		characterName: character.characterName,
																	}))}
																onSelectionChange={(value) => {
																	updateTemplateFieldSelection(field.name, value)
																	if (value === FLEET_COMMANDER_CUSTOM_VALUE) {
																		updateTemplateField('__fleetTrackingEnabled', 'false')
																		updateTemplateField('__fleetTrackingCharacterId', '')
																		updateTemplateField('__fleetTrackingCharacterName', '')
																		return
																	}
																	const selectedCharacter = (user?.characters ?? []).find(
																		(character) => character.characterId === value
																	)
																	const nextName = selectedCharacter?.characterName ?? ''
																	updateTemplateField(field.name, nextName)
																	updateTemplateField(
																		'__fleetTrackingCharacterId',
																		selectedCharacter?.characterId ?? ''
																	)
																	updateTemplateField(
																		'__fleetTrackingCharacterName',
																		nextName
																	)
																}}
																onValueChange={(value) => updateTemplateField(field.name, value)}
															/>
														) : (
															<>
																<Label htmlFor={field.name}>
																	{field.label}
																	{field.required && ' *'}
																</Label>
																{field.type === 'select' ? (
																	<div className="w-full">
																		<Select
																			inputId={field.name}
																			value={
																				templateFieldSelections[field.name] ??
																				templateFields[field.name] ??
																				''
																			}
																			onValueChange={(value) => {
																				updateTemplateFieldSelection(field.name, value)
																				updateTemplateField(field.name, value)
																			}}
																			options={(field.options ?? []).map((option) => ({
																				value: option,
																				label: option,
																			}))}
																			searchable
																		/>
																	</div>
																) : field.type === 'textarea' ? (
																	<Textarea
																		id={field.name}
																		value={templateFields[field.name] || ''}
																		onChange={(e) => {
																			autoResizeTextarea(e.currentTarget)
																			updateTemplateField(field.name, e.target.value)
																		}}
																		rows={1}
																		required={field.required}
																		className="resize-none overflow-hidden"
																		style={{ minHeight: '2.5rem' }}
																	/>
																) : (
																	<Input
																		id={field.name}
																		value={templateFields[field.name] || ''}
																		onChange={(e) =>
																			updateTemplateField(field.name, e.target.value)
																		}
																		required={field.required}
																	/>
																)}
															</>
														)}
													</div>
												))}
										</div>
										<div className="max-w-xl space-y-2">
											<Label htmlFor="template-default-text">Text after (optional)</Label>
											<Textarea
												id="template-default-text"
												value={templateDefaultText}
												onChange={(e) => {
													autoResizeTextarea(e.currentTarget)
													setTemplateDefaultText(e.target.value)
												}}
												rows={1}
												placeholder="Optional text appended after the template message"
												className="resize-none overflow-hidden"
												style={{ minHeight: '2.5rem' }}
											/>
										</div>
										{canCreateFleetTracking &&
										selectedTemplate.fieldSchema.some(
											(field) => field.type === 'system_fleet_tracking'
										) && (
											(() => {
												const fleetCommanderField = selectedTemplate.fieldSchema.find(
													(field) => field.type === 'system_fleet_commander'
												)
												const fleetCommanderSelection = fleetCommanderField
													? (templateFieldSelections[fleetCommanderField.name] ??
														FLEET_COMMANDER_CUSTOM_VALUE)
													: FLEET_COMMANDER_CUSTOM_VALUE
												const fleetTrackingDisabled =
													fleetCommanderSelection === FLEET_COMMANDER_CUSTOM_VALUE ||
													(templateFields.__fleetTrackingCharacterId ?? '').trim().length === 0
												const fleetTrackingDisabledReason = fleetTrackingDisabled
													? 'Select a valid Fleet Commander character to enable fleet tracking.'
													: undefined
												return (
											<SystemFleetTrackingField
												enabled={parseBooleanField(
													templateFields.__fleetTrackingEnabled,
													false
												)}
												disabled={fleetTrackingDisabled}
												disabledReason={fleetTrackingDisabledReason}
												onEnabledChange={(next) => {
													if (fleetTrackingDisabled && next) return
													updateTemplateField('__fleetTrackingEnabled', next ? 'true' : 'false')
												}}
											/>
												)
											})()
										)}
										{selectedTemplate.fieldSchema
											.filter((field) => field.type === 'system_frogsiren')
											.map((field) => (
												<SystemFrogsirenField
													key={field.name}
													fieldName={field.name}
													checked={parseBooleanField(templateFields[field.name], false)}
													onDisable={() => updateTemplateField(field.name, 'false')}
													onConfirmEnable={() => {
														requestConfirmation({
															title: 'Sound the Frogsiren?',
															description:
																'Are you really fucking sure you want to sound the frogsiren? Is the happening status: its? Is it UALX all over again?',
															confirmLabel: 'Sound It',
															intent: 'destructive',
															onConfirm: () => {
																updateTemplateField(field.name, 'true')
															},
														})
													}}
												/>
											))}
									</div>
								</div>
							) : null}

							{/* Submit Buttons */}
							<div className="text-sm">
								<span
									className={
										isOverRenderedMessageLimit
											? 'text-destructive font-bold'
											: 'text-primary font-semibold'
									}
								>
									Rendered length: {renderedOutboundLength}/{DISCORD_MESSAGE_MAX_LENGTH}
								</span>
							</div>
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
									disabled={!canSubmit || isSubmitting || isOverRenderedMessageLimit}
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
			{confirmationDialog}
		</Container>
	)
}
