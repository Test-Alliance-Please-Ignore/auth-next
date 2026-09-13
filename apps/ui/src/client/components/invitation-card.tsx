import { Calendar, Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAcceptInvitation, useDeclineInvitation } from '@/hooks/useGroups'
import { formatNumber, useAppTranslation } from '@/i18n'

import { VisibilityBadge } from './visibility-badge'

import type { GroupInvitationWithDetails } from '@/lib/api'

interface InvitationCardProps {
	invitation: GroupInvitationWithDetails
	onActionComplete?: () => void
}

export function InvitationCard({ invitation, onActionComplete }: InvitationCardProps) {
	const { t } = useAppTranslation()
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
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<CardTitle>{invitation.group.name}</CardTitle>
						<CardDescription>
							{invitation.group.description || t('invitations.noDescription')}
						</CardDescription>
					</div>
					<VisibilityBadge visibility={invitation.group.visibility} />
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Calendar className="h-4 w-4" />
					<span>
						{t('invitations.expiresIn', {
							count: daysUntilExpiry,
							formattedCount: formatNumber(daysUntilExpiry),
						})}
					</span>
				</div>

				<div className="flex gap-2">
					<Button
						variant="success"
						onClick={handleAccept}
						disabled={isLoading}
						loading={acceptInvitation.isPending}
						loadingText={t('invitations.accepting')}
						className="flex-1"
						showIcon={false}
					>
						<Check className="h-4 w-4" />
						{t('invitations.accept')}
					</Button>
					<Button
						variant="cancel"
						onClick={handleDecline}
						disabled={isLoading}
						loading={declineInvitation.isPending}
						loadingText={t('invitations.declining')}
						className="flex-1"
						showIcon={false}
					>
						<X className="h-4 w-4" />
						{t('invitations.decline')}
					</Button>
				</div>
			</CardContent>
		</Card>
	)
}
