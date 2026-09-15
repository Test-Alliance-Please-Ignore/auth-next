/**
 * Recommendations List Page
 *
 * Allows corp members to discover pending applications for their corporation
 * and add recommendations. Dialog opens directly from the list.
 */

import { MessageSquarePlus, Pencil, Trash2, Users } from 'lucide-react'
import { useState } from 'react'

import { MemberAvatar } from '@/components/member-avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatNumber, useAppTranslation } from '@/i18n'
import { formatRelativeTime } from '@/lib/date-utils'

import { AccessDeniedCard } from '../components/access-denied-card'
import { AddRecommendationDialog } from '../components/add-recommendation-dialog'
import { DeleteRecommendationDialog } from '../components/delete-recommendation-dialog'
import { RecommendationSentimentBadge } from '../components/recommendation-sentiment-badge'
import { usePendingRecommendations } from '../hooks'

import type { RecommendableApplication, Recommendation } from '../api'

export default function RecommendationsList() {
	const { t } = useAppTranslation()
	const { data: applications, isLoading, error } = usePendingRecommendations()
	const [selectedApp, setSelectedApp] = useState<RecommendableApplication | null>(null)
	const [editingRec, setEditingRec] = useState<{
		app: RecommendableApplication
		rec: Recommendation
	} | null>(null)
	const [deletingRec, setDeletingRec] = useState<Recommendation | null>(null)

	usePageTitle(t('applications.recommendations.list.title'))

	// Collect unique corporation IDs for name resolution
	const corporationIds = [...new Set((applications ?? []).map((a) => a.corporationId))]
	const { data: corpNames = {} } = useEntityNames(corporationIds, {
		enabled: corporationIds.length > 0,
	})

	if (isLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	if (error) {
		return (
			<Container>
				<AccessDeniedCard
					title={t('applications.recommendations.list.loadFailed')}
					message={
						error instanceof Error && error.message
							? error.message
							: t('applications.recommendations.list.loadFailed')
					}
				/>
			</Container>
		)
	}

	const apps = applications ?? []

	/** Convert userRecommendation to a full Recommendation shape for the dialogs */
	const toRecommendation = (app: RecommendableApplication): Recommendation | null => {
		const ur = app.userRecommendation
		if (!ur) return null
		return {
			id: ur.id,
			applicationId: app.id,
			userId: '',
			characterId: ur.characterId,
			characterName: '',
			recommendationText: ur.recommendationText,
			sentiment: ur.sentiment,
			isPublic: ur.isPublic,
			createdAt: '',
			updatedAt: '',
		}
	}

	return (
		<Container className="space-y-6">
			<PageHeader
				title={t('applications.recommendations.list.title')}
				description={t('applications.recommendations.list.description')}
			/>

			{/* Empty state */}
			{apps.length === 0 && (
				<Card>
					<CardContent className="text-center py-12">
						<Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
						<h3 className="text-lg font-semibold mb-2">
							{t('applications.recommendations.list.emptyTitle')}
						</h3>
						<p className="text-sm text-muted-foreground max-w-md mx-auto">
							{t('applications.recommendations.list.emptyDescription')}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Application cards */}
			{apps.length > 0 && (
				<div className="space-y-3">
					{apps.map((app) => (
						<ApplicationRecommendCard
							key={app.id}
							application={app}
							corporationName={corpNames[app.corporationId] ?? app.corporationId}
							onRecommend={() => setSelectedApp(app)}
							onEdit={() => {
								const rec = toRecommendation(app)
								if (rec) setEditingRec({ app, rec })
							}}
							onDelete={() => {
								const rec = toRecommendation(app)
								if (rec) setDeletingRec(rec)
							}}
						/>
					))}
				</div>
			)}

			{/* Add recommendation dialog */}
			<AddRecommendationDialog
				open={selectedApp !== null}
				onOpenChange={(open) => {
					if (!open) setSelectedApp(null)
				}}
				applicationId={selectedApp?.id ?? ''}
				applicationUserId=""
			/>

			{/* Edit recommendation dialog */}
			<AddRecommendationDialog
				open={editingRec !== null}
				onOpenChange={(open) => {
					if (!open) setEditingRec(null)
				}}
				applicationId={editingRec?.app.id ?? ''}
				applicationUserId=""
				existingRecommendation={editingRec?.rec}
			/>

			{/* Delete recommendation dialog */}
			<DeleteRecommendationDialog
				open={deletingRec !== null}
				onOpenChange={(open) => {
					if (!open) setDeletingRec(null)
				}}
				recommendation={deletingRec}
			/>
		</Container>
	)
}

function ApplicationRecommendCard({
	application,
	corporationName,
	onRecommend,
	onEdit,
	onDelete,
}: {
	application: RecommendableApplication
	corporationName: string
	onRecommend: () => void
	onEdit: () => void
	onDelete: () => void
}) {
	const { t } = useAppTranslation()
	const userRec = application.userRecommendation

	return (
		<Card
			className={userRec ? undefined : 'cursor-pointer transition-colors hover:bg-accent/30'}
			onClick={userRec ? undefined : onRecommend}
		>
			<CardContent className="flex flex-wrap items-center gap-4 py-4">
				{/* Avatar */}
				<MemberAvatar
					characterId={application.characterId}
					characterName={application.characterName}
					size="md"
				/>

				{/* Info */}
				<div className="flex-1 min-w-32">
					<div className="flex items-center gap-2">
						<span className="font-medium truncate">{application.characterName}</span>
						{application.recommendationCount > 0 && (
							<span className="text-xs text-muted-foreground flex items-center gap-1">
								({formatNumber(application.recommendationCount)})
							</span>
						)}
					</div>
					<div className="text-sm text-muted-foreground mt-0.5 break-words">
						{t('applications.recommendations.list.applyingTo', { corporation: corporationName })}
						{' · '}
						{formatRelativeTime(application.createdAt)}
					</div>
					{/* Show user's recommendation inline */}
					{userRec && (
						<div className="mt-2 flex items-start gap-2">
							<RecommendationSentimentBadge sentiment={userRec.sentiment} size="sm" />
							<p className="text-sm text-muted-foreground line-clamp-1">
								{userRec.recommendationText}
							</p>
						</div>
					)}
				</div>

				{/* Action */}
				<div className="flex items-center gap-2 shrink-0">
					{userRec ? (
						<>
							<Button
								size="sm"
								variant="ghost"
								aria-label={t('applications.recommendations.list.editAria', {
									character: application.characterName,
								})}
								onClick={(e) => {
									e.stopPropagation()
									onEdit()
								}}
							>
								<Pencil className="h-4 w-4" />
							</Button>
							<Button
								size="sm"
								variant="ghost"
								className="text-destructive hover:text-destructive"
								aria-label={t('applications.recommendations.list.deleteAria', {
									character: application.characterName,
								})}
								onClick={(e) => {
									e.stopPropagation()
									onDelete()
								}}
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</>
					) : (
						<Button
							size="sm"
							onClick={(e) => {
								e.stopPropagation()
								onRecommend()
							}}
						>
							<MessageSquarePlus className="h-4 w-4 mr-1.5" />
							{t('applications.recommendations.list.recommend')}
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
