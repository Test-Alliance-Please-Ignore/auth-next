import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Section } from '@/components/ui/section'
import { Textarea } from '@/components/ui/textarea'
import {
	useBroadcastTargets,
	useBroadcastTemplates,
	useCreateBroadcast,
	useSendBroadcast,
} from '@/hooks/useBroadcasts'
import { useUserMemberships } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { BroadcastTemplate } from '@/lib/api'

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
	const [isSubmitting, setIsSubmitting] = useState(false)

	// Fetch all broadcast targets available to the user
	const { data: targets } = useBroadcastTargets()

	// Get the selected target to determine groupId and type
	const selectedTarget = targets?.find((t) => t.id === selectedTargetId)

	// Fetch templates for the selected target's type and group
	const { data: templates } = useBroadcastTemplates(selectedTarget?.type, selectedTarget?.groupId)

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

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setIsSubmitting(true)

		try {
			if (!selectedTarget) {
				throw new Error('No target selected')
			}

			const title = `Broadcast to ${selectedTarget.name}`

			// Create the broadcast
			const broadcastData = {
				groupId: selectedTarget.groupId,
				targetId: selectedTargetId,
				templateId: selectedTemplateId === 'custom' ? undefined : selectedTemplateId,
				title,
				content:
					selectedTemplateId === 'custom'
						? { message: customMessage, mentionLevel }
						: { ...templateFields, mentionLevel },
			}

			const broadcast = await createBroadcast.mutateAsync(broadcastData)

			// Send it immediately
			await sendBroadcast.mutateAsync(broadcast.id)

			setMessage({ type: 'success', text: 'Broadcast sent successfully!' })
			setTimeout(() => {
				navigate('/broadcasts')
			}, 2000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to send broadcast',
			})
			setIsSubmitting(false)
		}
	}

	const canSubmit =
		selectedTargetId &&
		(selectedTemplateId === 'custom' ? customMessage.trim() : selectedTemplate !== null)

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

				<Card variant="interactive">
					<CardHeader>
						<CardTitle>Broadcast Details</CardTitle>
						<CardDescription>Configure your broadcast message</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit} className="space-y-6">
							{/* Target Selection */}
							<div className="space-y-2">
								<Label htmlFor="target">Target *</Label>
								<Select
									inputId="target"
									value={selectedTargetId}
									onValueChange={setSelectedTargetId}
									options={
										targets?.map((target) => ({ value: target.id,
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
										...(templates?.map((template) => ({ value: template.id,
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

							{/* Custom Message or Template Fields */}
							{selectedTemplateId === 'custom' ? (
								<div className="space-y-2">
									<Label htmlFor="message">Message *</Label>
									<Textarea
										id="message"
										value={customMessage}
										onChange={(e) => setCustomMessage(e.target.value)}
										rows={6}
										placeholder="Enter your broadcast message..."
										required
									/>
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

							{/* Submit Button */}
							<div className="flex justify-end gap-3 pt-4">
								<Button variant="cancel" type="button" onClick={() => navigate('/broadcasts')}>
									Cancel
								</Button>
								<Button variant="confirm"
									type="submit"
									disabled={!canSubmit || isSubmitting}
									loading={isSubmitting}
									loadingText="Sending..."
								>
									Send Broadcast
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
