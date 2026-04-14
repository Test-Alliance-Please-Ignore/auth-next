/**
 * Application Detail Page (Applicant View)
 *
 * Shows full details of a specific application including:
 * - Application details (character, corporation, status, text)
 * - Activity timeline
 * - Withdraw functionality
 */

import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, Briefcase } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { MemberAvatar } from '@/components/member-avatar'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/ui/loading'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/useAuth'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'

import { canWithdrawApplication } from '../api'
import { AccessDeniedCard } from '../components/access-denied-card'
import { AddRecommendationDialog } from '../components/add-recommendation-dialog'
import { ApplicationStatusBadge } from '../components/application-status-badge'
import { ApplicationTimeline } from '../components/application-timeline'
import { DeleteRecommendationDialog } from '../components/delete-recommendation-dialog'
import { MessagesPanel } from '../components/messages-panel'
import { RecommendationList } from '../components/recommendation-list'
import {
	useApplication,
	useApplicationActivity,
	useMessageCount,
	useRecommendations,
	useWithdrawApplication,
} from '../hooks'

import type { Recommendation } from '../api'

// ============================================================================
// Component
// ============================================================================

/**
 * Main Application Detail Component (Applicant View)
 */
export default function ApplicationDetail() {
	const { applicationId } = useParams<{ applicationId: string }>()
	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { showSuccess, showError } = useMessage()

	// State
	const [showWithdrawDialog, setShowWithdrawDialog] = useState(false)
	const [showAddRecommendationDialog, setShowAddRecommendationDialog] = useState(false)
	const [editingRecommendation, setEditingRecommendation] = useState<Recommendation | undefined>(
		undefined
	)
	const [deletingRecommendation, setDeletingRecommendation] = useState<Recommendation | null>(null)

	// Fetch data
	const {
		data: application,
		isLoading: applicationLoading,
		error: applicationError,
	} = useApplication(applicationId!)
	const { data: activityLog, isLoading: activityLoading } = useApplicationActivity(applicationId!)
	const { data: recommendations } = useRecommendations(applicationId!)
	const { data: messageCount = 0 } = useMessageCount(applicationId!)

	// Mutations
	const withdrawMutation = useWithdrawApplication()

	// Set page title
	usePageTitle(
		application
			? `Application to ${application.corporationName || 'Corporation'}`
			: 'Application Details'
	)

	// Check if user owns this application
	const isOwner = user?.id === application?.userId

	// Check if application can be withdrawn
	const canWithdraw = application ? canWithdrawApplication(application) : false

	// Handlers
	const handleWithdrawClick = () => {
		setShowWithdrawDialog(true)
	}

	const handleWithdrawConfirm = async () => {
		if (!applicationId) return

		try {
			await withdrawMutation.mutateAsync(applicationId)
			showSuccess('Application withdrawn successfully')
			setShowWithdrawDialog(false)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to withdraw application')
		}
	}

	const handleBackClick = () => {
		navigate('/my-applications')
	}

	const handleAddRecommendation = () => {
		setEditingRecommendation(undefined)
		setShowAddRecommendationDialog(true)
	}

	const handleEditRecommendation = (rec: Recommendation) => {
		setEditingRecommendation(rec)
		setShowAddRecommendationDialog(true)
	}

	const handleDeleteRecommendation = (rec: Recommendation) => {
		setDeletingRecommendation(rec)
	}

	const handleRecommendationSuccess = () => {
		setShowAddRecommendationDialog(false)
		setEditingRecommendation(undefined)
	}

	const handleDeleteSuccess = () => {
		setDeletingRecommendation(null)
	}

	// Filter to show only public recommendations for the applicant view
	const publicRecommendations =
		recommendations?.filter((rec) => rec.isPublic || rec.userId === user?.id) || []

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check if application ID is provided
	if (!applicationId) {
		return <Navigate to="/my-applications" replace />
	}

	// Loading state
	if (authLoading || applicationLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	// Error state
	if (applicationError) {
		return (
			<Container>
				<AccessDeniedCard
					title="Failed to Load Application"
					message={applicationError instanceof Error ? applicationError.message : 'An unexpected error occurred'}
					backLabel="Back to My Applications"
					onBack={handleBackClick}
				/>
			</Container>
		)
	}

	// Access denied - user doesn't own this application
	if (application && !isOwner) {
		return (
			<Container>
				<AccessDeniedCard
					message="You don't have permission to view this application."
					backLabel="Back to My Applications"
					onBack={handleBackClick}
				/>
			</Container>
		)
	}

	// Application not found
	if (!application) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto">
					<CardHeader className="text-center">
						<Briefcase className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
						<CardTitle>Application Not Found</CardTitle>
						<CardDescription>This application doesn't exist or has been removed.</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="ghost" onClick={handleBackClick}>
							<ArrowLeft className="h-4 w-4" />
							Back to My Applications
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	// Main content
	return (
		<Container>
			{/* Breadcrumb Navigation */}
			<Breadcrumb className="mb-6">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink to="/my-applications">My Applications</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>{application.corporationName || 'Application'}</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			{/* Header Card */}
			<Card className="mb-6">
				<CardContent className="pt-6">
					<div className="flex items-start gap-4">
						{/* Character Portrait */}
						<MemberAvatar
							characterId={application.characterId}
							characterName={application.characterName}
							size="lg"
						/>

						{/* Application Header Info */}
						<div className="flex-1 min-w-0">
							<h1 className="text-2xl font-bold text-foreground mb-1">
								{application.characterName}
							</h1>
							{application.corporationName && (
								<p className="text-lg text-muted-foreground mb-3">
									Applied to: <span className="font-medium">{application.corporationName}</span>
								</p>
							)}
							<div className="flex items-center gap-3">
								<ApplicationStatusBadge status={application.status} size="md" />
								<span className="text-sm text-muted-foreground">
									Submitted{' '}
									{formatDistanceToNow(new Date(application.createdAt), { addSuffix: true })}
								</span>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Tabbed Content */}
			<Tabs defaultValue="details" className="space-y-6">
				<TabsList className="w-full sm:w-auto">
					<TabsTrigger value="details" className="flex-1 sm:flex-none">
						Details
					</TabsTrigger>
					<TabsTrigger value="recommendations" className="flex-1 sm:flex-none">
						Recommendations
						{publicRecommendations.length > 0 && (
							<span className="ml-1.5 text-xs opacity-70">({publicRecommendations.length})</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="history" className="flex-1 sm:flex-none">
						History
					</TabsTrigger>
					<TabsTrigger value="messages" className="flex-1 sm:flex-none">
						Messages
						{messageCount > 0 && (
							<span className="ml-1.5 text-xs opacity-70">({messageCount})</span>
						)}
					</TabsTrigger>
				</TabsList>

				{/* Details Tab */}
				<TabsContent value="details" className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Application Text</CardTitle>
							<CardDescription>
								Your message to the corporation explaining why you want to join
							</CardDescription>
						</CardHeader>
						<CardContent>
							<p className="text-foreground whitespace-pre-wrap break-words leading-relaxed">
								{application.applicationText}
							</p>
						</CardContent>
					</Card>

					{/* Review Information (only for final decisions) */}
					{application.reviewedAt &&
						(application.status === 'accepted' || application.status === 'rejected') && (
							<Card>
								<CardHeader>
									<CardTitle>Review Information</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									<div>
										<p className="text-sm font-medium text-muted-foreground">Reviewed By</p>
										<p className="text-foreground">
											{application.reviewedByCharacterName || 'Unknown'}
										</p>
									</div>
									<Separator />
									<div>
										<p className="text-sm font-medium text-muted-foreground">Reviewed At</p>
										<p className="text-foreground">
											{formatDistanceToNow(new Date(application.reviewedAt), { addSuffix: true })}
										</p>
									</div>
									{application.reviewNotes && (
										<>
											<Separator />
											<div>
												<p className="text-sm font-medium text-muted-foreground">Review Notes</p>
												<p className="text-foreground whitespace-pre-wrap mt-1 italic">
													"{application.reviewNotes}"
												</p>
											</div>
										</>
									)}
								</CardContent>
							</Card>
						)}

					{/* Withdraw Button */}
					{canWithdraw && (
						<div className="flex justify-end">
							<Button variant="destructive" onClick={handleWithdrawClick}>
								Withdraw Application
							</Button>
						</div>
					)}
				</TabsContent>

				{/* Recommendations Tab */}
				<TabsContent value="recommendations">
					<Card>
						<CardHeader>
							<CardTitle>Recommendations</CardTitle>
							<CardDescription>
								Community recommendations for this application (public recommendations only)
							</CardDescription>
						</CardHeader>
						<CardContent>
							<RecommendationList
								applicationId={applicationId!}
								currentUserId={user?.id}
								onAddRecommendation={handleAddRecommendation}
								onEditRecommendation={handleEditRecommendation}
								onDeleteRecommendation={handleDeleteRecommendation}
							/>
						</CardContent>
					</Card>
				</TabsContent>

				{/* History Tab */}
				<TabsContent value="history">
					<Card>
						<CardHeader>
							<CardTitle>Activity History</CardTitle>
							<CardDescription>
								Timeline of all actions and status changes for this application
							</CardDescription>
						</CardHeader>
						<CardContent>
							{activityLoading ? (
								<div className="flex items-center justify-center py-8">
									<LoadingSpinner size="md" />
								</div>
							) : activityLog && activityLog.length > 0 ? (
								<ApplicationTimeline activityLog={activityLog} showActors={true} />
							) : (
								<p className="text-center text-muted-foreground py-8">No activity recorded yet</p>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* Messages Tab */}
				<TabsContent value="messages">
					<Card>
						<CardHeader>
							<CardTitle>Messages</CardTitle>
							<CardDescription>
								Communicate with the HR team about your application
							</CardDescription>
						</CardHeader>
						<CardContent>
							<MessagesPanel
								applicationId={applicationId!}
								currentUserId={user!.id}
								canSend={canWithdraw}

							/>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			{/* Withdraw Confirmation Dialog */}
			<Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Withdraw Application?</DialogTitle>
						<DialogDescription>
							Are you sure you want to withdraw your application to {application.corporationName}?
							This action cannot be undone, and you will need to submit a new application if you
							change your mind.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => setShowWithdrawDialog(false)}
							disabled={withdrawMutation.isPending}
						>
							Cancel
						</Button>
						<Button variant="destructive"
							onClick={handleWithdrawConfirm}
							loading={withdrawMutation.isPending}
							loadingText="Withdrawing..."
						>
							Withdraw Application
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Add/Edit Recommendation Dialog */}
			<AddRecommendationDialog
				open={showAddRecommendationDialog}
				onOpenChange={setShowAddRecommendationDialog}
				applicationId={applicationId!}
				applicationUserId={application?.userId || ''}
				existingRecommendation={editingRecommendation}
				onSuccess={handleRecommendationSuccess}
			/>

			{/* Delete Recommendation Dialog */}
			<DeleteRecommendationDialog
				open={!!deletingRecommendation}
				onOpenChange={(open) => !open && setDeletingRecommendation(null)}
				recommendation={deletingRecommendation}
				onSuccess={handleDeleteSuccess}
			/>
	</Container>
	)
}
