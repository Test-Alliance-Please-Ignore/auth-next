import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { parseBroadcastSrpMode } from '@repo/broadcasts'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
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
import { BroadcastPreviewPane } from '@/features/broadcasts/components/broadcast-preview-pane'
import { DiscordTimestampHelperDialog } from '@/features/broadcasts/components/discord-timestamp-helper-dialog'
import { useDoctrines, useStagingSystems } from '@/features/doctrines/hooks'
import {
	getInitialDoctrineFieldState,
	resolveDoctrineSelectionFromValue,
} from '@/features/broadcasts/components/system-doctrine-field'
import {
	FLEET_COMMANDER_CUSTOM_VALUE,
} from '@/features/broadcasts/components/system-fleet-commander-field'
import { TemplateFieldsEditor } from '@/features/broadcasts/components/template-fields-editor'
import { generateSrpTokenAtFormLoad } from '@/features/broadcasts/srp-token-generator'
import {
	getInitialStagingFieldState,
	resolveStagingSelectionFromValue,
} from '@/features/broadcasts/components/system-staging-field'
import { useBroadcastDraftInitializer } from '@/features/broadcasts/hooks/use-broadcast-draft-initializer'
import { renderBroadcastTemplateMessage } from '@/features/broadcasts/message-template-renderer'
import {
	autoResizeTextarea,
	parseBooleanField,
	resolveFleetCommanderSelectionFromFields,
} from '@/features/broadcasts/utils'

const DISCORD_MESSAGE_MAX_LENGTH = 2000
const FROGSIREN_EMOTE = '<:fs:1496199804470952080>'


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
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const { hasPermission, isAdmin } = useUserPermissions()
	const { data: draftBroadcast, isLoading: draftLoading } = useBroadcast(draftId)

	// Form state
	const [selectedTargetId, setSelectedTargetId] = useState<string>('')
	const [selectedTemplateId, setSelectedTemplateId] = useState<string>('custom')
	const [customMessage, setCustomMessage] = useState<string>('')
	const [templateFields, setTemplateFields] = useState<Record<string, string>>({})
	const [templateFieldSelections, setTemplateFieldSelections] = useState<Record<string, string>>({})
	const [messageParts, setMessageParts] = useState<{ prefix: string; suffix: string }>({
		prefix: '',
		suffix: '',
	})
	const [mentionLevel, setMentionLevel] = useState<'none' | 'here' | 'everyone'>('here')
	const [isSending, setIsSending] = useState(false)
	const [isSavingDraft, setIsSavingDraft] = useState(false)
	const [timestampHelperOpen, setTimestampHelperOpen] = useState(false)
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

	const handleMentionLevelChange = useCallback((value: string) => {
		const nextLevel = value as typeof mentionLevel
		if (nextLevel !== 'everyone') {
			setMentionLevel(nextLevel)
			return
		}

		// Declining the confirmation should default to @here.
		setMentionLevel('here')
		requestConfirmation({
			title: 'Ping @everyone?',
			description:
				'Are you sure you want to ping @everyone? This is sent to offline people as well. Prefer @here instead.',
			confirmLabel: 'Yes, Ping @everyone',
			cancelLabel: "It's not that important",
			confirmButtonVariant: 'danger',
			cancelButtonVariant: 'confirm',
			onConfirm: () => {
				setMentionLevel('everyone')
			},
		})
	}, [requestConfirmation])

	useBroadcastDraftInitializer({
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
	})

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
				messageParts.prefix.trim(),
				renderBroadcastTemplateMessage(selectedTemplate.messageTemplate, templateFields, true),
				messageParts.suffix.trim(),
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
		messageParts.prefix,
		messageParts.suffix,
		selectedTarget,
		selectedTemplate,
		senderCharacterName,
		templateFields,
	])
	const renderedOutboundLength = renderedOutboundMessage.length
	const isOverRenderedMessageLimit = renderedOutboundLength > DISCORD_MESSAGE_MAX_LENGTH
	// Initialize template fields when template is selected
	const handleTemplateChange = useCallback((templateId: string) => {
		setSelectedTemplateId(templateId)
		if (templateId === 'custom') {
			setTemplateFields({})
			setMessageParts({ prefix: '', suffix: '' })
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
					// Preserve commander-derived defaults when the template schema
					// orders fleet-tracking before/after fleet-commander.
					if (initialFields.__fleetTrackingEnabled === undefined) {
						initialFields.__fleetTrackingEnabled = 'false'
					}
					if (initialFields.__fleetTrackingCharacterId === undefined) {
						initialFields.__fleetTrackingCharacterId = ''
					}
					if (initialFields.__fleetTrackingCharacterName === undefined) {
						initialFields.__fleetTrackingCharacterName = ''
					}
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
			setMessageParts({ prefix: '', suffix: '' })
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
							__prefixText: messageParts.prefix,
							__defaultText: messageParts.suffix,
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
						<form onSubmit={handleSend} className="min-w-0 space-y-6">
							<div className="grid min-w-0 gap-4 lg:grid-cols-3">
								{/* Target Selection */}
								<div className="min-w-0 space-y-2">
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
								<div className="min-w-0 space-y-2">
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
								<div className="min-w-0 space-y-2">
									<Label htmlFor="mentions">Mentions</Label>
									<Select
										inputId="mentions"
										value={mentionLevel}
										onValueChange={handleMentionLevelChange}
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
								<div className="grid min-w-0 gap-4 [grid-template-areas:'preview''form'] lg:[grid-template-areas:'form_preview'] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-stretch">
									<BroadcastPreviewPane message={customMessage} />
									<div className="[grid-area:form] min-w-0 space-y-2">
										<Label htmlFor="message">Message *</Label>
										<Textarea
											id="message"
											value={customMessage}
											onChange={(e) => setCustomMessage(e.target.value)}
											rows={10}
											placeholder="Enter your broadcast message..."
											required
											className="h-[16rem] resize-none"
										/>
										<p className="text-xs text-muted-foreground">
											Write your custom message. Supports Discord markdown formatting.
										</p>
									</div>
								</div>
							) : selectedTemplate ? (
								<div className="grid min-w-0 gap-4 [grid-template-areas:'preview''form'] lg:[grid-template-areas:'form_preview'] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-stretch">
									<BroadcastPreviewPane message={renderedOutboundMessage} />
									<div className="[grid-area:form] min-w-0 space-y-4">
										<TemplateFieldsEditor
											fields={selectedTemplate.fieldSchema}
											templateFields={templateFields}
											templateFieldSelections={templateFieldSelections}
											doctrines={doctrines}
											stagingSystems={stagingSystems}
											userCharacters={user?.characters ?? []}
											mainCharacterId={user?.mainCharacterId}
											canCreateFleetTracking={canCreateFleetTracking}
											messageParts={messageParts}
											onMessagePartsChange={setMessageParts}
											onUpdateTemplateField={updateTemplateField}
											onUpdateTemplateFieldSelection={updateTemplateFieldSelection}
										/>
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
							<div className="flex flex-col gap-3 pt-4 sm:flex-row sm:justify-end">
								<Button
									variant="cancel"
									type="button"
									onClick={() => navigate('/broadcasts')}
									disabled={isSubmitting}
									className="w-full sm:w-auto"
								>
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
									className="w-full sm:w-auto"
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
									className="w-full sm:w-auto"
								>
									Send Broadcast
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</Section>

			<DiscordTimestampHelperDialog
				open={timestampHelperOpen}
				onOpenChange={setTimestampHelperOpen}
			/>
			{confirmationDialog}
		</Container>
	)
}
