import { Mail } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

import { InvitationCard } from '@/components/invitation-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { useAuth } from '@/hooks/useAuth'
import { usePendingInvitations } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'

export default function InvitationsPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('invitations.title'))
	const navigate = useNavigate()
	const { user, isLoading: authLoading } = useAuth()
	const canViewInvitations =
		user?.is_admin === true || user?.roles?.includes(ROLE_CORE_ALLIANCE_MEMBER) === true
	const { data: invitations, isLoading } = usePendingInvitations({ enabled: canViewInvitations })

	if (!authLoading && !canViewInvitations) {
		return <Navigate to="/dashboard" replace />
	}

	if (authLoading || isLoading) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<p className="text-muted-foreground">{t('invitations.loading')}</p>
			</div>
		)
	}

	return (
		<Container>
			<PageHeader title={t('invitations.title')} description={t('invitations.description')} />

			<Section>
				{/* Invitations List */}
				{invitations && invitations.length > 0 ? (
					<div className="space-y-4">
						{invitations.map((invitation) => (
							<InvitationCard
								key={invitation.id}
								invitation={invitation}
								onActionComplete={() => {
									void navigate('/my-groups')
								}}
							/>
						))}
					</div>
				) : (
					/* Empty State */
					<Card variant="default">
						<CardContent className="py-16 text-center">
							<div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-6">
								<Mail className="h-10 w-10 text-muted-foreground" />
							</div>
							<h3 className="text-xl font-semibold mb-2">{t('invitations.emptyHeading')}</h3>
							<p className="text-muted-foreground mb-6 max-w-md mx-auto">
								{t('invitations.emptyDescription')}
							</p>
							<Button onClick={() => navigate('/groups')} size="lg">
								{t('invitations.browse')}
							</Button>
						</CardContent>
					</Card>
				)}
			</Section>
		</Container>
	)
}
