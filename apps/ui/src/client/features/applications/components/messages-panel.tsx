/**
 * Messages Panel Component
 *
 * Main container for message thread and input between HR and applicant.
 * Features auto-scroll, character counter, loading states, and template support (for HR).
 */

import { MessageSquare, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { LoadingSpinner } from '@/components/ui/loading'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { formatNumber, useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import { useMessages, useSendMessage } from '../hooks'
import { MessageItem } from './message-item'
import { TemplateSelector } from './template-selector'

import type { KeyboardEvent } from 'react'
import type { MessageTemplate } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface MessagesPanelProps {
	applicationId: string
	currentUserId: string
	recipientId?: string
	corporationId?: string
	canSend: boolean
	showTemplates?: boolean
	className?: string
}

// ============================================================================
// Constants
// ============================================================================

const MAX_MESSAGE_LENGTH = 2000
const MIN_MESSAGE_LENGTH = 10

// ============================================================================
// Component
// ============================================================================

/**
 * Messages panel with conversation thread and input
 *
 * Features:
 * - Auto-scroll to latest message
 * - Character counter on input
 * - Loading and empty states
 * - Template selector (for HR users)
 */
export function MessagesPanel({
	applicationId,
	currentUserId,
	recipientId,
	corporationId,
	canSend,
	showTemplates = false,
	className,
}: MessagesPanelProps) {
	const { t } = useAppTranslation()
	const [messageText, setMessageText] = useState('')
	const [pendingTemplate, setPendingTemplate] = useState<MessageTemplate | null>(null)
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	// Fetch messages
	const { data: messages, isLoading, error } = useMessages(applicationId)

	// Send message mutation
	const sendMutation = useSendMessage()

	// Use the same validation for the button and keyboard shortcut.
	const isValidMessage =
		messageText.trim().length >= MIN_MESSAGE_LENGTH && messageText.length <= MAX_MESSAGE_LENGTH
	const canSubmit = canSend && isValidMessage && !sendMutation.isPending

	// Auto-scroll to bottom when messages change
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages])

	// Handle send
	const handleSend = async () => {
		if (!canSubmit) {
			return
		}

		try {
			await sendMutation.mutateAsync({
				applicationId,
				data: {
					...(recipientId ? { recipientId } : {}),
					message: messageText.trim(),
				},
			})
			setMessageText('')
		} catch {
			// Keep the draft; the mutation error state renders feedback below.
		}
	}

	// Handle key press (Ctrl+Enter to send)
	const handleKeyPress = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			void handleSend()
		}
	}

	// Handle template selection - insert template content into message
	const handleSelectTemplate = (template: MessageTemplate) => {
		if (messageText.trim().length > 0) {
			setPendingTemplate(template)
		} else {
			setMessageText(template.messageTemplate)
			textareaRef.current?.focus()
		}
	}

	const handleConfirmTemplate = () => {
		if (pendingTemplate) {
			setMessageText(pendingTemplate.messageTemplate)
			setPendingTemplate(null)
			textareaRef.current?.focus()
		}
	}

	// Loading state
	if (isLoading) {
		return (
			<div className={cn('flex items-center justify-center py-8', className)}>
				<LoadingSpinner size="md" />
			</div>
		)
	}

	// Error state
	if (error) {
		return (
			<div className={cn('text-center py-8', className)}>
				<p role="alert" className="text-destructive">
					{error instanceof Error ? error.message : t('applications.messages.loadFailed')}
				</p>
			</div>
		)
	}

	return (
		<div className={cn('space-y-4', className)}>
			{/* Message List */}
			<div className="space-y-3 max-h-[500px] overflow-y-auto overflow-x-hidden pr-2">
				{messages && messages.length > 0 ? (
					<>
						{messages.map((msg) => (
							<MessageItem key={msg.id} message={msg} currentUserId={currentUserId} />
						))}
						<div ref={messagesEndRef} />
					</>
				) : (
					<div className="text-center py-12">
						<MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
						<p className="text-muted-foreground">
							{t(canSend ? 'applications.messages.emptySend' : 'applications.messages.empty')}
						</p>
					</div>
				)}
			</div>

			{/* Input Area */}
			{canSend && (
				<>
					<Separator />
					<div className="space-y-3 pt-2">
						{/* Template selector for HR users */}
						{showTemplates && corporationId && (
							<TemplateSelector
								corporationId={corporationId}
								onSelectTemplate={handleSelectTemplate}
							/>
						)}

						{/* Message input */}
						<Textarea
							ref={textareaRef}
							value={messageText}
							onChange={(e) => setMessageText(e.target.value)}
							onKeyDown={handleKeyPress}
							placeholder={t('applications.messages.placeholder')}
							aria-label={t('applications.messages.inputLabel')}
							maxLength={MAX_MESSAGE_LENGTH}
							rows={3}
							disabled={sendMutation.isPending}
							className="resize-y"
						/>

						{/* Character counter and send button */}
						<div className="flex flex-wrap items-center justify-end gap-3">
							{sendMutation.isError && (
								<span role="alert" className="text-xs text-destructive">
									{t('applications.messages.sendFailed')}
								</span>
							)}
							<div className="flex items-center gap-2 text-xs">
								{messageText.length > 0 && messageText.trim().length < MIN_MESSAGE_LENGTH && (
									<span className="text-muted-foreground">
										{t('applications.messages.minimum', {
											count: formatNumber(MIN_MESSAGE_LENGTH),
										})}
									</span>
								)}
								<span
									className={cn(
										'font-mono',
										messageText.length > MAX_MESSAGE_LENGTH
											? 'text-destructive'
											: 'text-muted-foreground'
									)}
								>
									{t('applications.messages.counter', {
										current: formatNumber(messageText.length),
										maximum: formatNumber(MAX_MESSAGE_LENGTH),
									})}
								</span>
							</div>
							<Button onClick={handleSend} disabled={!canSubmit} size="sm">
								{sendMutation.isPending ? (
									<LoadingSpinner size="sm" className="mr-2" />
								) : (
									<Send className="h-4 w-4" />
								)}
								{t(
									sendMutation.isPending
										? 'applications.messages.sending'
										: 'applications.messages.send'
								)}
							</Button>
						</div>
					</div>
				</>
			)}

			{/* Closed application notice */}
			{!canSend && messages && messages.length > 0 && (
				<div className="text-center py-4 text-sm text-muted-foreground border-t">
					{t('applications.messages.closed')}
				</div>
			)}

			{/* Template overwrite confirmation */}
			<ConfirmationDialog
				open={pendingTemplate !== null}
				title={t('applications.messages.replaceTitle')}
				description={t('applications.messages.replaceDescription')}
				confirmLabel={t('applications.messages.replace')}
				intent="secondary"
				onCancel={() => setPendingTemplate(null)}
				onConfirm={handleConfirmTemplate}
			/>
		</div>
	)
}
