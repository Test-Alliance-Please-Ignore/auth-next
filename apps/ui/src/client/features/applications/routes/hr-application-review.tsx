/**
 * HR Application Review Page
 *
 * Full application review interface for HR staff.
 * Shows application details, timeline, and action panel for status changes.
 * Requires HR Viewer role minimum.
 */

import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, ArrowLeft, Briefcase, Lock } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

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
import { LoadingSpinner } from '@/components/ui/loading'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MemberAvatar } from '@/components/member-avatar'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'

import { AddHRNoteDialog } from '../components/add-hr-note-dialog'
import { ApplicationActionPanel } from '../components/application-action-panel'
import { ApplicationStatusBadge } from '../components/application-status-badge'
import { ApplicationTimeline } from '../components/application-timeline'
import { DeleteHRNoteDialog } from '../components/delete-hr-note-dialog'
import { HRNotesList } from '../components/hr-notes-list'
import { RecommendationList } from '../components/recommendation-list'
import { useApplication, useApplicationActivity, useHRNote, useRecommendations } from '../hooks'
import { useHrPermissionCheck } from '../../hr/hooks'

// ============================================================================
// Component
// ============================================================================

/**
 * HR Application Review page with full details and actions
 */
export default function HrApplicationReview() {
	const { corporationId, applicationId } = useParams<{
		corporationId: string
		applicationId: string
	}>()
	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()

	// Dialog state for HR Notes
	const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false)
	const [editNoteDialogOpen, setEditNoteDialogOpen] = useState(false)
	const [deleteNoteDialogOpen, setDeleteNoteDialogOpen] = useState(false)
	const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)

	// Check HR permission (userId derived from authenticated session)
	const { data: permission, isLoading: permissionLoading } = useHrPermissionCheck(
		corporationId ? { corporationId } : null
	)

	// Fetch application data
	const {
		data: application,
		isLoading: applicationLoading,
		error: applicationError,
	} = useApplication(applicationId!)

	// Fetch activity log and recommendations
	const { data: activityLog, isLoading: activityLoading } = useApplicationActivity(applicationId!)
	const { data: recommendations } = useRecommendations(applicationId!)

	// Fetch selected HR note for edit/delete
	const { data: selectedNote } = useHRNote(selectedNoteId)

	// Set page title
	usePageTitle(
		application
			? `Review Application - ${application.characterName}`
			: 'Review Application'
	)

	// Handlers
	const handleBackClick = () => {
		navigate(`/corporations/${corporationId}/hr/applications`)
	}

	const handleAddNote = () => {
		setAddNoteDialogOpen(true)
	}

	const handleEditNote = (noteId: string) => {
		setSelectedNoteId(noteId)
		setEditNoteDialogOpen(true)
	}

	const handleDeleteNote = (noteId: string) => {
		setSelectedNoteId(noteId)
		setDeleteNoteDialogOpen(true)
	}

	const handleNoteDialogSuccess = () => {
		setSelectedNoteId(null)
		// Refetch is handled by React Query cache invalidation
	}

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check required params
	if (!corporationId || !applicationId) {
		return <Navigate to="/my-corporations" replace />
	}

	// Loading state
	if (authLoading || permissionLoading || applicationLoading) {
		return (
			<div className="container mx-auto max-w-5xl px-4 py-8">
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</div>
		)
	}

	// Access denied - no HR role
	// Check permission - site admins always have access
	if (!permission?.hasPermission && !user?.is_admin) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							Access Denied
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							You don't have HR permissions for this corporation. Contact an HR Admin to
							request access.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="outline" onClick={() => navigate('/my-corporations')}>
							Back to My Corporations
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Error state
	if (applicationError) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							Failed to Load Application
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{applicationError instanceof Error
								? applicationError.message
								: 'An unexpected error occurred'}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="outline" onClick={handleBackClick}>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Applications
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Application not found
	if (!application) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto">
					<CardHeader className="text-center">
						<Briefcase className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
						<CardTitle>Application Not Found</CardTitle>
						<CardDescription>
							This application doesn't exist or has been removed.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="outline" onClick={handleBackClick}>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Applications
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Verify application belongs to this corporation
	if (application.corporationId !== corporationId) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							Invalid Application
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							This application does not belong to the specified corporation.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="outline" onClick={handleBackClick}>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Applications
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Main content
	return (
		<div className="container mx-auto max-w-5xl px-4 py-8">
			{/* Breadcrumb Navigation */}
			<Breadcrumb className="mb-6">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink to="/my-corporations">My Corporations</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbLink to={`/corporations/${corporationId}/hr/dashboard`}>
							HR Dashboard
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbLink to={`/corporations/${corporationId}/hr/applications`}>
							Applications
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>{application.characterName}</BreadcrumbPage>
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
						{recommendations && recommendations.length > 0 && (
							<span className="ml-1.5 text-xs opacity-70">({recommendations.length})</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="history" className="flex-1 sm:flex-none">
						History
					</TabsTrigger>
				</TabsList>

				{/* Details Tab */}
				<TabsContent value="details" className="space-y-6">
					{/* Application Text */}
					<Card>
						<CardHeader>
							<CardTitle>Application Text</CardTitle>
							<CardDescription>
								The applicant's message explaining why they want to join
							</CardDescription>
						</CardHeader>
						<CardContent>
							<p className="text-foreground whitespace-pre-wrap leading-relaxed">
								{application.applicationText}
							</p>
						</CardContent>
					</Card>

					{/* Review Information (if reviewed) */}
					{application.reviewedAt && (
						<Card>
							<CardHeader>
								<CardTitle>Review Information</CardTitle>
								<CardDescription>Details about the application review</CardDescription>
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

					{/* HR Notes Section (ADMIN ONLY) */}
					{user?.is_admin && (
						<Card className="border-warning/30 bg-warning/5">
							<CardHeader>
								<div className="flex items-center gap-2">
									<Lock className="h-4 w-4 text-warning" />
									<CardTitle className="text-lg">HR Notes (Admin Only)</CardTitle>
								</div>
								<CardDescription>
									Private internal notes about this applicant. Only visible to site administrators.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<HRNotesList
									subjectUserId={application.userId}
									subjectCharacterName={application.characterName}
									onAddNote={handleAddNote}
									onEditNote={handleEditNote}
									onDeleteNote={handleDeleteNote}
								/>
							</CardContent>
						</Card>
					)}

					{/* HR Action Panel */}
					<ApplicationActionPanel
						application={application}
						userRole={permission.currentRole}
						onStatusChange={() => {
							// Status change is handled by React Query cache invalidation
							// No need to manually refetch
						}}
					/>
				</TabsContent>

				{/* Recommendations Tab */}
				<TabsContent value="recommendations">
					<Card>
						<CardHeader>
							<CardTitle>Recommendations</CardTitle>
							<CardDescription>
								Community recommendations for this application (all recommendations visible to HR)
							</CardDescription>
						</CardHeader>
						<CardContent>
							<RecommendationList
								applicationId={applicationId!}
								currentUserId={user?.id}
								// HR cannot add recommendations, only view them
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
								<p className="text-center text-muted-foreground py-8">
									No activity recorded yet
								</p>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			{/* Back Button */}
			<div className="mt-8">
				<Button variant="outline" onClick={handleBackClick}>
					<ArrowLeft className="mr-2 h-4 w-4" />
					Back to Applications List
				</Button>
			</div>

			{/* HR Notes Dialogs */}
			{user?.is_admin && (
				<>
					<AddHRNoteDialog
						open={addNoteDialogOpen}
						onOpenChange={setAddNoteDialogOpen}
						subjectUserId={application.userId}
						subjectCharacterId={application.characterId}
						subjectCharacterName={application.characterName}
						onSuccess={handleNoteDialogSuccess}
					/>

					<AddHRNoteDialog
						open={editNoteDialogOpen}
						onOpenChange={setEditNoteDialogOpen}
						subjectUserId={application.userId}
						subjectCharacterId={selectedNote?.subjectCharacterId || application.characterId}
						subjectCharacterName={selectedNote?.subjectCharacterName || application.characterName}
						existingNote={selectedNote}
						onSuccess={handleNoteDialogSuccess}
					/>

					<DeleteHRNoteDialog
						open={deleteNoteDialogOpen}
						onOpenChange={setDeleteNoteDialogOpen}
						note={selectedNote || null}
						onSuccess={handleNoteDialogSuccess}
					/>
				</>
			)}
		</div>
	)
}
