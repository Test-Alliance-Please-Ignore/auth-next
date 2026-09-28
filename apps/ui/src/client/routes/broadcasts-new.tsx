import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { getPersonalBroadcastTemplateContent, parseBroadcastSrpMode } from '@repo/broadcasts'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { BroadcastFeedback } from '@/features/broadcasts/components/broadcast-feedback'
import { BroadcastPreviewPane } from '@/features/broadcasts/components/broadcast-preview-pane'
import { DiscordTimestampHelperDialog } from '@/features/broadcasts/components/discord-timestamp-helper-dialog'
import { SavePersonalBroadcastTemplate } from '@/features/broadcasts/components/save-personal-broadcast-template'
import {
	getInitialDoctrineFieldState,
	resolveDoctrineSelectionFromValue,
} from '@/features/broadcasts/components/system-doctrine-field'
import { FLEET_COMMANDER_CUSTOM_VALUE } from '@/features/broadcasts/components/system-fleet-commander-field'
import {
	getInitialStagingFieldState,
	resolveStagingSelectionFromValue,
} from '@/features/broadcasts/components/system-staging-field'
import { TemplateFieldsEditor } from '@/features/broadcasts/components/template-fields-editor'
import { useBroadcastDraftInitializer } from '@/features/broadcasts/hooks/use-broadcast-draft-initializer'
import { renderBroadcastTemplateMessage } from '@/features/broadcasts/message-template-renderer'
import { convertUnixTimestampsForPreview } from '@/features/broadcasts/preview-timestamps'
import { generateSrpTokenAtFormLoad } from '@/features/broadcasts/srp-token-generator'
import { canUseTemplateForTarget } from '@/features/broadcasts/template-shortcuts'
import {
	autoResizeTextarea,
	parseBooleanField,
	resolveFleetCommanderSelectionFromFields,
} from '@/features/broadcasts/utils'
import { useDoctrines, useStagingSystems } from '@/features/doctrines/hooks'
import { useAuth } from '@/hooks/useAuth'
import {
	useBroadcast,
	useBroadcastTargets,
	useBroadcastTemplates,
	useCreateBroadcast,
	usePersonalBroadcastTemplates,
	useSendBroadcast,
	useUpdateBroadcast,
} from '@/hooks/useBroadcasts'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { formatNumber, useAppTranslation } from '@/i18n'

import type { FormEvent } from 'react'
import type { PersonalBroadcastTemplate } from '@repo/broadcasts'
import type { MessageText } from '@/hooks/useMessage'

const DISCORD_MESSAGE_MAX_LENGTH = 2000
const FROGSIREN_EMOTE = '<:fs:1496199804470952080>'

function wrapWithFrogsirenBanner(message: string): string {
	const banner = Array.from({ length: 16 }, () => FROGSIREN_EMOTE).join(' ')
	return `${banner}\n\n${message}\n\n${banner}`
}

export default function NewBroadcastPage() {
	const [searchParams] = useSearchParams()
	const draftId = searchParams.get('draftId') ?? ''
	// A different compose URL starts a fresh form even when this route stays mounted.
	// Draft identity takes precedence over any shortcut parameters.
	const templateId = draftId ? null : searchParams.get('templateId')
	const targetId = draftId ? null : searchParams.get('targetId')
	const personalTemplateId = draftId ? null : searchParams.get('personalTemplateId')
	const editPersonalTemplate = searchParams.get('editTemplate') === 'true'
	if (personalTemplateId !== null) {
		return (
			<PersonalBroadcastComposer
				key={JSON.stringify([personalTemplateId, editPersonalTemplate])}
				id={personalTemplateId}
				edit={editPersonalTemplate}
			/>
		)
	}
	return (
		<BroadcastComposer
			key={JSON.stringify([draftId, templateId, targetId])}
			draftId={draftId}
			requestedTemplateId={templateId}
			requestedTargetId={targetId}
		/>
	)
}

function PersonalBroadcastComposer({ id, edit }: { id: string; edit: boolean }) {
	const { t } = useAppTranslation()
	const templates = usePersonalBroadcastTemplates()
	const template = templates.data?.find((item) => item.id === id)
	const title = t(edit ? 'broadcasts.personal.editTitle' : 'broadcasts.composer.newTitle')
	usePageTitle(title)
	if (template) {
		return (
			<BroadcastComposer
				draftId=""
				requestedTemplateId={template.templateId ?? 'custom'}
				requestedTargetId={template.targetId}
				personalTemplate={template}
				editPersonalTemplate={edit}
			/>
		)
	}
	return (
		<Container>
			<PageHeader title={title} />
			<Section>
				<Card>
					<CardContent className="space-y-3 py-4">
						<p role={templates.isPending ? 'status' : 'alert'}>
							{t(
								templates.isError
									? 'broadcasts.personal.loadFailed'
									: templates.isPending
										? 'broadcasts.personal.loading'
										: 'broadcasts.personal.missing'
							)}
						</p>
						<Button asChild variant="secondary">
							<Link to="/broadcasts/new">{t('broadcasts.composer.shortcutChoose')}</Link>
						</Button>
						{templates.isError && (
							<Button variant="secondary" onClick={() => void templates.refetch()}>
								{t('broadcasts.templates.retry')}
							</Button>
						)}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}

function BroadcastComposer({
	draftId,
	requestedTemplateId,
	requestedTargetId,
	personalTemplate,
	editPersonalTemplate = false,
}: {
	draftId: string
	requestedTemplateId: string | null
	requestedTargetId: string | null
	personalTemplate?: PersonalBroadcastTemplate
	editPersonalTemplate?: boolean
}) {
	const { t } = useAppTranslation()
	const isEditMode = draftId.length > 0
	const hasShortcut = requestedTemplateId !== null || requestedTargetId !== null
	const shortcutInitializedRef = useRef(false)
	const [shortcutInitialized, setShortcutInitialized] = useState(false)
	const title = t(
		editPersonalTemplate
			? 'broadcasts.personal.editTitle'
			: isEditMode
				? 'broadcasts.composer.editTitle'
				: 'broadcasts.composer.newTitle'
	)
	usePageTitle(title)
	const navigate = useNavigate()
	const createBroadcast = useCreateBroadcast()
	const sendBroadcast = useSendBroadcast()
	const updateBroadcast = useUpdateBroadcast()
	const { user } = useAuth()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const { hasPermission, isAdmin } = useUserPermissions()
	const {
		data: draftBroadcast,
		isLoading: draftLoading,
		error: draftError,
		isError: draftFailed,
	} = useBroadcast(draftId, isEditMode)

	// Form state
	const [selectedTargetId, setSelectedTargetId] = useState(requestedTargetId ?? '')
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
	const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	useEffect(
		() => () => {
			if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current)
		},
		[]
	)
	const navigateAfter = (path: string, delay: number) => {
		if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current)
		navigationTimerRef.current = setTimeout(() => navigate(path), delay)
	}
	const autoSelectedTemplateTargetsRef = useRef<Set<string>>(new Set())

	// Fetch all broadcast targets available to the user
	const {
		data: targets,
		error: targetsError,
		isError: targetsFailed,
		refetch: refetchTargets,
	} = useBroadcastTargets()

	// Get the selected target to determine type
	const selectedTarget = targets?.find((t) => t.id === selectedTargetId)

	// Fetch templates scoped to the selected target/type
	const {
		data: availableTemplates,
		error: templatesError,
		isError: templatesFailed,
		refetch: refetchTemplates,
	} = useBroadcastTemplates(selectedTarget?.type, selectedTarget?.id)
	const templates = useMemo(
		() =>
			selectedTarget
				? availableTemplates?.filter((template) =>
						canUseTemplateForTarget(template, selectedTarget)
					)
				: undefined,
		[availableTemplates, selectedTarget]
	)
	const { data: doctrines = [], isLoading: doctrinesLoading } = useDoctrines()
	const { data: stagingSystems = [], isLoading: stagingLoading } = useStagingSystems()
	const shortcutInvalid =
		hasShortcut &&
		(!requestedTemplateId ||
			!requestedTargetId ||
			(targets !== undefined && !selectedTarget) ||
			(templates !== undefined &&
				!(shortcutInitialized
					? selectedTemplateId === 'custom'
					: personalTemplate?.templateId === null) &&
				!templates.some(
					(template) =>
						template.id === (shortcutInitialized ? selectedTemplateId : requestedTemplateId)
				)))
	const shortcutPending = hasShortcut && !shortcutInitialized && !shortcutInvalid

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: MessageText } | null>(
		null
	)

	const handleMentionLevelChange = useCallback(
		(value: string) => {
			const nextLevel = value as typeof mentionLevel
			if (nextLevel !== 'everyone') {
				setMentionLevel(nextLevel)
				return
			}

			// Declining the confirmation should default to @here.
			setMentionLevel('here')
			requestConfirmation({
				title: (t) => t('broadcasts.composer.mentionTitle'),
				description: (t) => t('broadcasts.composer.mentionDescription'),
				confirmLabel: (t) => t('broadcasts.composer.mentionConfirm'),
				cancelLabel: (t) => t('broadcasts.composer.mentionCancel'),
				confirmButtonVariant: 'danger',
				cancelButtonVariant: 'confirm',
				onConfirm: () => {
					setMentionLevel('everyone')
				},
			})
		},
		[requestConfirmation]
	)

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
		user?.characters.find((character) => character.characterId === user.mainCharacterId)
			?.characterName ?? 'Unknown Sender'
	const renderedOutboundMessage = useMemo(() => {
		if (!selectedTarget) return ''

		let message = selectedTemplate
			? [
					messageParts.prefix.trim(),
					renderBroadcastTemplateMessage(selectedTemplate.messageTemplate, templateFields, true),
					messageParts.suffix.trim(),
				]
					.filter(Boolean)
					.join('\n\n')
			: customMessage

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
	const handleTemplateChange = useCallback(
		(templateId: string) => {
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
							initialFields.__fleetTrackingEnabled = 'true'
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
		},
		[stagingSystems, templates, user?.characters, user?.mainCharacterId]
	)

	useEffect(() => {
		if (
			!hasShortcut ||
			shortcutInitializedRef.current ||
			shortcutInvalid ||
			targetsFailed ||
			templatesFailed ||
			!selectedTarget ||
			!templates ||
			stagingLoading ||
			(personalTemplate && doctrinesLoading) ||
			!user ||
			!requestedTemplateId
		)
			return

		// Claim initialization before applying defaults: Strict Mode and query refetches
		// must not regenerate SRP tokens or overwrite fields the author has entered.
		shortcutInitializedRef.current = true
		handleTemplateChange(requestedTemplateId)
		if (personalTemplate) {
			const template = templates.find((item) => item.id === requestedTemplateId)
			const {
				mentionLevel: mention,
				__prefixText: prefix,
				__defaultText: suffix,
				message: custom,
				...fields
			} = getPersonalBroadcastTemplateContent(
				personalTemplate.content,
				template?.fieldSchema.map((field) => field.name) ?? ['message']
			)
			setMentionLevel(mention === 'none' || mention === 'everyone' ? mention : 'here')
			setMessageParts({ prefix: prefix ?? '', suffix: suffix ?? '' })
			if (personalTemplate.templateId) {
				// Keep fresh generated defaults (especially SRP tokens), then overlay
				// saved author values and let the normal field controls resolve them.
				setTemplateFields((current) => ({
					...current,
					...fields,
					...(custom !== undefined ? { message: custom } : {}),
				}))
				setTemplateFieldSelections({})
			} else {
				setCustomMessage(custom ?? '')
			}
		}
		setShortcutInitialized(true)
	}, [
		handleTemplateChange,
		doctrinesLoading,
		personalTemplate,
		hasShortcut,
		requestedTemplateId,
		selectedTarget,
		shortcutInvalid,
		stagingLoading,
		targetsFailed,
		templates,
		templatesFailed,
		user,
	])

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
					updateTemplateField('__fleetTrackingEnabled', 'true')
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
					updateTemplateField('__fleetTrackingCharacterId', fleetCommanderState.trackingCharacterId)
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
		if (isEditMode || hasShortcut || !selectedTargetId || !templates || templates.length === 0)
			return

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
	}, [
		handleTemplateChange,
		hasShortcut,
		isEditMode,
		selectedTargetId,
		selectedTemplateId,
		templates,
	])

	useEffect(() => {
		if (canCreateFleetTracking) return
		if ((templateFields.__fleetTrackingEnabled ?? '').toLowerCase() !== 'true') return
		updateTemplateField('__fleetTrackingEnabled', 'false')
	}, [canCreateFleetTracking, templateFields.__fleetTrackingEnabled])

	// Titles, template values and the Discord footer are canonical outgoing content.
	// Keep them stable when only the author’s interface language changes.
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

	const handleSend = async (e: FormEvent) => {
		e.preventDefault()
		if (editPersonalTemplate || !canSubmit || isSubmitting) return
		if (isOverRenderedMessageLimit) {
			setMessage({
				type: 'error',
				text: (t) =>
					t('broadcasts.composer.tooLong', {
						length: formatNumber(renderedOutboundLength),
						max: formatNumber(DISCORD_MESSAGE_MAX_LENGTH),
					}),
			})
			return
		}
		if (isEditMode && draftBroadcast?.status !== 'draft') {
			setMessage({ type: 'error', text: (t) => t('broadcasts.composer.onlyDraft') })
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
				setMessage({
					type: 'error',
					text: (t) => sendResult.delivery.errorMessage || t('broadcasts.feedback.sendFailed'),
				})
				setIsSending(false)
				return
			}

			// Fleet-tracking side effect: if the broadcast started a session, redirect
			// to it. If the broadcast asked for tracking but it failed, surface the
			// reason and stay on this page so the user can investigate.
			if (sendResult.trackingSessionId) {
				setMessage({
					type: 'success',
					text: (t) => t('broadcasts.feedback.tracking'),
				})
				navigateAfter(`/fleet-tracking/${sendResult.trackingSessionId}`, 1200)
				return
			}
			if (sendResult.trackingError) {
				setMessage({
					type: 'error',
					text: (t) => t('broadcasts.feedback.trackingFailed', { error: sendResult.trackingError }),
				})
				setIsSending(false)
				return
			}

			setMessage({ type: 'success', text: (t) => t('broadcasts.composer.sent') })
			navigateAfter('/broadcasts', 2000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error && error.message
						? error.message
						: t('broadcasts.feedback.sendFailed'),
			})
			setIsSending(false)
		}
	}

	const handleSaveAsDraft = async () => {
		if (editPersonalTemplate || !canSubmit || isSubmitting) return
		if (isEditMode && draftBroadcast?.status !== 'draft') {
			setMessage({ type: 'error', text: (t) => t('broadcasts.composer.onlyDraft') })
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
			setMessage({ type: 'success', text: (t) => t('broadcasts.composer.saved') })
			navigateAfter(`/broadcasts/${broadcast.id}`, 1000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error && error.message
						? error.message
						: t('broadcasts.composer.saveFailed'),
			})
			setIsSavingDraft(false)
		}
	}

	const canSubmit =
		!shortcutPending &&
		!shortcutInvalid &&
		!targetsFailed &&
		!templatesFailed &&
		Boolean(selectedTarget) &&
		(selectedTemplateId === 'custom'
			? customMessage.trim().length > 0
			: Boolean(selectedTemplate)) &&
		(!isEditMode || draftBroadcast?.status === 'draft')
	const isSubmitting = isSending || isSavingDraft || updateBroadcast.isPending
	const loadFailure = draftFailed
		? { messageKey: 'broadcasts.composer.draftLoadFailed' as const, error: draftError }
		: targetsFailed
			? { messageKey: 'broadcasts.composer.targetsFailed' as const, error: targetsError }
			: templatesFailed
				? { messageKey: 'broadcasts.composer.templatesFailed' as const, error: templatesError }
				: isEditMode && !draftLoading && !draftBroadcast
					? { messageKey: 'broadcasts.composer.draftMissing' as const }
					: null

	return (
		<Container>
			<PageHeader
				title={title}
				description={
					editPersonalTemplate
						? t('broadcasts.personal.editDescription')
						: isEditMode
							? t('broadcasts.composer.editDescription')
							: t('broadcasts.composer.newDescription')
				}
				action={
					<Button variant="cancel" onClick={() => navigate('/broadcasts')} size="default">
						{t('common.cancel')}
					</Button>
				}
			/>

			<Section>
				{hasShortcut &&
					(shortcutPending || shortcutInvalid || targetsFailed || templatesFailed) && (
						<Card>
							<CardContent className="space-y-3 py-3 text-sm">
								<p role={shortcutInvalid ? 'alert' : 'status'}>
									{t(
										shortcutInvalid
											? 'broadcasts.composer.shortcutInvalid'
											: targetsFailed || templatesFailed
												? 'broadcasts.composer.shortcutFailed'
												: 'broadcasts.composer.shortcutLoading'
									)}
								</p>
								<div className="flex flex-wrap gap-2">
									<Button asChild variant="secondary" size="sm">
										<Link to="/broadcasts/new">{t('broadcasts.composer.shortcutChoose')}</Link>
									</Button>
									{(targetsFailed || templatesFailed) && (
										<Button
											type="button"
											variant="secondary"
											size="sm"
											onClick={() => {
												void refetchTargets()
												void refetchTemplates()
											}}
										>
											{t('broadcasts.templates.retry')}
										</Button>
									)}
								</div>
							</CardContent>
						</Card>
					)}
				{/* Success/Error Message */}
				{isEditMode && draftLoading && (
					<Card>
						<CardContent className="py-3 text-sm text-muted-foreground">
							{t('broadcasts.composer.loadingDraft')}
						</CardContent>
					</Card>
				)}
				{loadFailure && !hasShortcut && (
					<Card>
						<CardContent className="py-3 text-sm text-destructive" role="alert">
							<BroadcastFeedback {...loadFailure} />
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
							<p
								role={message.type === 'error' ? 'alert' : 'status'}
								className={message.type === 'error' ? 'text-destructive' : 'text-primary'}
							>
								{typeof message.text === 'function' ? message.text(t) : message.text}
							</p>
						</CardContent>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle>{t('broadcasts.detail.title')}</CardTitle>
						<CardDescription>{t('broadcasts.composer.configure')}</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSend} className="min-w-0 space-y-6">
							<div className="grid min-w-0 gap-4 lg:grid-cols-3">
								{/* Target Selection */}
								<div className="min-w-0 space-y-2">
									<Label htmlFor="target">{t('broadcasts.target')} *</Label>
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
										placeholder={t('broadcasts.composer.targetPlaceholder')}
										disabled={isEditMode || (hasShortcut && !shortcutInitialized)}
									/>
									<p className="text-xs text-muted-foreground">
										{t('broadcasts.composer.targetHelp')}
									</p>
								</div>

								{/* Template Selection */}
								<div className="min-w-0 space-y-2">
									<Label htmlFor="template">{t('broadcasts.template')}</Label>
									<Select
										value={selectedTemplateId}
										onValueChange={handleTemplateChange}
										inputId="template"
										options={[
											{ value: 'custom', label: t('broadcasts.composer.customMessage') },
											...(templates?.map((template) => ({
												value: template.id,
												label: template.name,
											})) ?? []),
										]}
										placeholder={t('broadcasts.composer.customMessage')}
										disabled={
											!selectedTargetId || isEditMode || (hasShortcut && !shortcutInitialized)
										}
									/>
									<p className="text-xs text-muted-foreground">
										{!selectedTargetId
											? t('broadcasts.composer.targetFirst')
											: t('broadcasts.composer.templateHelp')}
									</p>
								</div>

								{/* Mention Level Selection */}
								<div className="min-w-0 space-y-2">
									<Label htmlFor="mentions">{t('broadcasts.composer.mentions')}</Label>
									<Select
										inputId="mentions"
										value={mentionLevel}
										onValueChange={handleMentionLevelChange}
										options={[
											{ value: 'none', label: t('broadcasts.composer.noMention') },
											{ value: 'here', label: '@here' },
											{ value: 'everyone', label: '@everyone' },
										]}
									/>
									<p className="text-xs text-muted-foreground">
										{t('broadcasts.composer.mentionHelp')}
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
									{t('broadcasts.composer.timestamp.title')}
								</Button>
							</div>

							{/* Custom Message or Template Fields */}
							{selectedTemplateId === 'custom' ? (
								<div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-stretch">
									<div className="min-w-0 space-y-2">
										<Label htmlFor="message">{t('broadcasts.composer.message')} *</Label>
										<Textarea
											id="message"
											value={customMessage}
											onChange={(e) => setCustomMessage(e.target.value)}
											rows={10}
											placeholder={t('broadcasts.composer.messagePlaceholder')}
											required
											className="h-[16rem] resize-none"
										/>
										<p className="text-xs text-muted-foreground">
											{t('broadcasts.composer.messageHelp')}
										</p>
									</div>
									<BroadcastPreviewPane message={customMessage} />
								</div>
							) : selectedTemplate ? (
								<div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-stretch">
									<div className="min-w-0 space-y-4">
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
									<BroadcastPreviewPane message={renderedOutboundMessage} />
								</div>
							) : null}

							<SavePersonalBroadcastTemplate
								source={personalTemplate}
								editOnly={editPersonalTemplate}
								disabled={!canSubmit || isSubmitting}
								getValues={() => ({
									targetId: selectedTargetId,
									templateId: selectedTemplateId === 'custom' ? null : selectedTemplateId,
									content: getPersonalBroadcastTemplateContent(
										buildBroadcastData().content,
										selectedTemplate?.fieldSchema.map((field) => field.name) ?? ['message']
									),
								})}
							/>

							{/* Submit Buttons */}
							<div className="text-sm">
								<span
									className={
										isOverRenderedMessageLimit
											? 'text-destructive font-bold'
											: 'text-primary font-semibold'
									}
								>
									{t('broadcasts.composer.renderedLength', {
										length: formatNumber(renderedOutboundLength),
										max: formatNumber(DISCORD_MESSAGE_MAX_LENGTH),
									})}
								</span>
							</div>
							{!editPersonalTemplate && (
								<div className="flex flex-col gap-3 pt-4 sm:flex-row sm:justify-end">
									<Button
										variant="cancel"
										type="button"
										onClick={() => navigate('/broadcasts')}
										disabled={isSubmitting}
										className="w-full sm:w-auto"
									>
										{t('common.cancel')}
									</Button>
									<Button
										variant="secondary"
										type="button"
										disabled={!canSubmit || isSubmitting}
										loading={isSavingDraft}
										loadingText={t('broadcasts.composer.saving')}
										showIcon={false}
										onClick={handleSaveAsDraft}
										className="w-full sm:w-auto"
									>
										{t('broadcasts.composer.saveDraft')}
									</Button>
									<Button
										variant="confirm"
										type="submit"
										disabled={!canSubmit || isSubmitting || isOverRenderedMessageLimit}
										loading={isSending}
										loadingText={t('broadcasts.sending')}
										showIcon={false}
										className="w-full sm:w-auto"
									>
										{t('broadcasts.composer.send')}
									</Button>
								</div>
							)}
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
