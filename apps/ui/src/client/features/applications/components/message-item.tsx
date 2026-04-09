/**
 * Message Item Component
 *
 * Displays a single message in a conversation thread between HR and applicant.
 * Uses visual differentiation (alignment/color) for sender vs recipient.
 */

import { formatDistanceToNow } from 'date-fns'

import { MemberAvatar } from '@/components/member-avatar'
import { cn } from '@/lib/utils'

import type { ApplicationMessage } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface MessageItemProps {
	message: ApplicationMessage
	currentUserId: string
	className?: string
}

// ============================================================================
// Component
// ============================================================================

/**
 * Single message display component
 *
 * Features:
 * - Avatar + character name in header
 * - Relative timestamp (e.g., "5 minutes ago")
 * - Visual differentiation for sender vs recipient (alignment/color)
 * - Whitespace-preserving message text
 */
export function MessageItem({
	message,
	currentUserId,
	className,
}: MessageItemProps) {
	const isMine = message.senderId === currentUserId
	const senderName = isMine ? 'You' : (message.senderCharacterName || 'Unknown')

	return (
		<div className={cn('flex gap-3', isMine ? 'flex-row-reverse' : 'flex-row', className)}>
			<MemberAvatar
				characterId={message.senderCharacterId || message.senderId}
				characterName={senderName}
				size="sm"
			/>
			<div className={cn('flex-1 space-y-1', isMine ? 'items-end' : 'items-start')}>
				<div
					className={cn('flex items-center gap-2', isMine ? 'flex-row-reverse' : 'flex-row')}
				>
					<span className="font-medium text-sm text-foreground">{senderName}</span>
					<span className="text-xs text-muted-foreground">
						{formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
					</span>
				</div>
				<div
					className={cn(
						'rounded-lg p-3 max-w-[85%]',
						isMine ? 'bg-primary/10 ml-auto' : 'bg-muted mr-auto'
					)}
				>
					<p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message.message}</p>
				</div>
			</div>
		</div>
	)
}
