import { Trash2 } from 'lucide-react'

import { useCancelInvitation, useGroupInvitations } from '@/hooks/useGroups'
import { formatDate, formatNumber, useAppTranslation } from '@/i18n'

import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'

interface PendingInvitationsListProps {
	groupId: string
}

export function PendingInvitationsList({ groupId }: PendingInvitationsListProps) {
	const { t } = useAppTranslation()
	const { data: invitations, isLoading, error } = useGroupInvitations(groupId)
	const cancelInvitation = useCancelInvitation()

	if (isLoading) {
		return (
			<Card className="p-4">
				<h3 className="text-lg font-semibold mb-3">{t('invitations.pending.title')}</h3>
				<div className="text-sm text-gray-500">{t('invitations.loading')}</div>
			</Card>
		)
	}

	if (error) {
		return (
			<Card className="p-4">
				<h3 className="text-lg font-semibold mb-3">{t('invitations.pending.title')}</h3>
				<div className="text-sm text-red-600">{t('invitations.pending.loadFailed')}</div>
			</Card>
		)
	}

	if (!invitations || invitations.length === 0) {
		return (
			<Card className="p-4">
				<h3 className="text-lg font-semibold mb-3">{t('invitations.pending.title')}</h3>
				<div className="text-sm text-gray-500">{t('invitations.emptyHeading')}</div>
			</Card>
		)
	}

	return (
		<Card className="p-4">
			<div className="flex items-center justify-between mb-3">
				<h3 className="text-lg font-semibold">{t('invitations.pending.title')}</h3>
				<Badge variant="secondary">{formatNumber(invitations.length)}</Badge>
			</div>

			<div className="space-y-2">
				{invitations.map((invitation) => (
					<div
						key={invitation.id}
						className="rounded-lg border border-border p-3 transition-colors hover:bg-muted/30"
					>
						<div className="flex items-start justify-between">
							<div className="flex-1">
								<div className="font-medium text-sm">
									{invitation.inviteeCharacterName || t('invitations.pending.unknownCharacter')}
								</div>
								<div className="text-xs text-gray-500 mt-1">
									{t('invitations.pending.invitedBy', {
										name: invitation.inviterCharacterName || t('groupDetail.unknownUser'),
									})}
								</div>
								<div className="text-xs text-gray-500">
									{t('invitations.pending.sent', { date: formatDate(invitation.createdAt) })}
								</div>
								<div className="text-xs text-gray-500">
									{t('groupDetail.inviteCodes.expires', { date: formatDate(invitation.expiresAt) })}
								</div>
							</div>
							<Badge variant="ghost" className="ml-2">
								{t(`invitations.pending.status.${invitation.status}`)}
							</Badge>
						</div>
						<div className="mt-3 flex justify-end">
							<Button
								variant="ghost"
								size="sm"
								onClick={() =>
									cancelInvitation.mutate({
										invitationId: invitation.id,
										groupId,
									})
								}
								disabled={cancelInvitation.isPending}
								aria-label={t('invitations.pending.cancelFor', {
									name:
										invitation.inviteeCharacterName || t('invitations.pending.unknownCharacter'),
								})}
							>
								<Trash2 className="h-4 w-4" />
								<span className="ml-2">{t('common.cancel')}</span>
							</Button>
						</div>
					</div>
				))}
			</div>
		</Card>
	)
}
