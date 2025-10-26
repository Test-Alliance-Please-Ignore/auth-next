import { Calendar, Check, X } from 'lucide-react'

import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SuccessButton } from '@/components/ui/success-button'
import { useAcceptInvitation, useDeclineInvitation } from '@/hooks/useGroups'

import { VisibilityBadge } from './visibility-badge'

import type { GroupInvitationWithDetails } from '@/lib/api'

interface InvitationCardProps {
	invitation: GroupInvitationWithDetails
	onActionComplete?: () => void
}

export function InvitationCard({ invitation, onActionComplete }: InvitationCardProps) {
	const acceptInvitation = useAcceptInvitation()
	const declineInvitation = useDeclineInvitation()

	const handleAccept = async () => {
		try {
			await acceptInvitation.mutateAsync(invitation.id)
			onActionComplete?.()
		} catch (error) {
			console.error('Failed to accept invitation:', error)
		}
	}

	const handleDecline = async () => {
		try {
			await declineInvitation.mutateAsync(invitation.id)
			onActionComplete?.()
		} catch (error) {
			console.error('Failed to decline invitation:', error)
		}
	}

	const isLoading = acceptInvitation.isPending || declineInvitation.isPending
	const expiresAt = new Date(invitation.expiresAt)
	const daysUntilExpiry = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

	return (
		<Card variant="interactive">
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<CardTitle>{invitation.group.name}</CardTitle>
						<CardDescription>{invitation.group.description || 'No description'}</CardDescription>
					</div>
					<VisibilityBadge visibility={invitation.group.visibility} />
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Calendar className="h-4 w-4" />
					<span>
						Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}
					</span>
				</div>

				<div className="flex gap-2">
					<SuccessButton
						onClick={handleAccept}
						disabled={isLoading}
						loading={acceptInvitation.isPending}
						loadingText="Accepting..."
						className="flex-1"
						showIcon={false}
					>
						<Check className="mr-2 h-4 w-4" />
						Accept
					</SuccessButton>
					<CancelButton
						onClick={handleDecline}
						disabled={isLoading}
						loading={declineInvitation.isPending}
						loadingText="Declining..."
						className="flex-1"
						showIcon={false}
					>
						<X className="mr-2 h-4 w-4" />
						Decline
					</CancelButton>
				</div>
			</CardContent>
		</Card>
	)
}
