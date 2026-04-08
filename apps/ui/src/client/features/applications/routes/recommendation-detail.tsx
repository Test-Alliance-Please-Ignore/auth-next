/**
 * Recommendation Detail Page
 *
 * Allows a corp member to view an applicant's info and write/edit their recommendation.
 * This is NOT the HR review page — it shows limited information only.
 */

import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, FileText, User } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'

import { AddRecommendationDialog } from '../components/add-recommendation-dialog'
import { DeleteRecommendationDialog } from '../components/delete-recommendation-dialog'
import { RecommendationCard } from '../components/recommendation-card'
import { useApplicationForRecommender } from '../hooks'

import type { Recommendation } from '../api'

export default function RecommendationDetail() {
	const { applicationId } = useParams<{ applicationId: string }>()
	const navigate = useNavigate()
	const { user } = useAuth()
	const {
		data: application,
		isLoading,
		error,
	} = useApplicationForRecommender(applicationId ?? '')

	const { data: corpNames = {} } = useEntityNames(
		application ? [application.corporationId] : [],
		{ enabled: !!application }
	)

	const [showAddDialog, setShowAddDialog] = useState(false)
	const [showDeleteDialog, setShowDeleteDialog] = useState(false)
	const [editRecommendation, setEditRecommendation] = useState<Recommendation | undefined>()

	usePageTitle(application ? `Recommend ${application.characterName}` : 'Recommendation')

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<LoadingSpinner size="lg" />
			</div>
		)
	}

	if (error || !application) {
		return (
			<div className="max-w-3xl mx-auto space-y-4">
				<Button variant="ghost" size="sm" onClick={() => navigate('/recommendations')}>
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back to Recommendations
				</Button>
				<Card className="border-destructive">
					<CardHeader>
						<CardTitle className="text-destructive">Error</CardTitle>
						<CardDescription>
							{error instanceof Error ? error.message : 'Application not found or not accessible'}
						</CardDescription>
					</CardHeader>
				</Card>
			</div>
		)
	}

	const corporationName =
		corpNames[application.corporationId] ?? `Corporation ${application.corporationId}`
	const userRecommendation = application.userRecommendation

	const handleAdd = () => {
		setEditRecommendation(undefined)
		setShowAddDialog(true)
	}

	const handleEdit = (rec: Recommendation) => {
		setEditRecommendation(rec)
		setShowAddDialog(true)
	}

	const handleDelete = (rec: Recommendation) => {
		setEditRecommendation(rec)
		setShowDeleteDialog(true)
	}

	return (
		<div className="max-w-3xl mx-auto space-y-6">
			{/* Back button */}
			<Button variant="ghost" size="sm" onClick={() => navigate('/recommendations')}>
				<ArrowLeft className="h-4 w-4 mr-2" />
				Back to Recommendations
			</Button>

			{/* Applicant info card */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<User className="h-5 w-5 text-muted-foreground" />
						<div>
							<CardTitle>{application.characterName}</CardTitle>
							<CardDescription>
								Applying to {corporationName}
								{' · '}
								{formatDistanceToNow(new Date(application.createdAt), { addSuffix: true })}
							</CardDescription>
						</div>
						<Badge variant="secondary" className="ml-auto capitalize">
							{application.status.replace('_', ' ')}
						</Badge>
					</div>
				</CardHeader>
			</Card>

			{/* Application text */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<FileText className="h-4 w-4 text-muted-foreground" />
						<CardTitle className="text-base">Application</CardTitle>
					</div>
				</CardHeader>
				<CardContent>
					<div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
						{application.applicationText}
					</div>
				</CardContent>
			</Card>

			{/* Recommendation section */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle className="text-base">Your Recommendation</CardTitle>
							<CardDescription>
								{application.recommendationCount > 0 && (
									<>
										{application.recommendationCount} recommendation{application.recommendationCount !== 1 ? 's' : ''} total
										{' · '}
									</>
								)}
								{userRecommendation
									? 'You have already submitted a recommendation'
									: 'Share your thoughts on this applicant'}
							</CardDescription>
						</div>
						{!userRecommendation && (
							<Button size="sm" onClick={handleAdd}>
								Write Recommendation
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					{userRecommendation ? (
						<RecommendationCard
							recommendation={userRecommendation}
							canEdit
							canDelete
							onEdit={handleEdit}
							onDelete={handleDelete}
						/>
					) : (
						<div className="text-center py-6 text-muted-foreground text-sm">
							You haven't written a recommendation yet. Click the button above to get started.
						</div>
					)}
				</CardContent>
			</Card>

			{/* Add/Edit dialog */}
			<AddRecommendationDialog
				open={showAddDialog}
				onOpenChange={setShowAddDialog}
				applicationId={applicationId!}
				applicationUserId=""
				existingRecommendation={editRecommendation}
			/>

			{/* Delete dialog */}
			<DeleteRecommendationDialog
				open={showDeleteDialog}
				onOpenChange={setShowDeleteDialog}
				recommendation={editRecommendation ?? null}
			/>
		</div>
	)
}
