/**
 * HR Application Review Page
 *
 * Full application review interface for HR staff.
 * Shows application details, timeline, and action panel for status changes.
 * Requires HR Viewer role minimum.
 */

import { useQueries } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, Briefcase, Lock } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { MemberAvatar } from '@/components/member-avatar'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/useAuth'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useEntityNames } from '@/hooks/useEntityNames'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { apiClient } from '@/lib/api'
import { formatISKShort } from '@/lib/format-utils'
import { formatSkillPoints } from '@repo/eve-types'

import { useHrPermissionCheck } from '../../hr/hooks'
import { useCanAccessCorporation } from '../../corporations/hooks'
import { ACTIVE_APPLICATION_STATUSES } from '../constants'
import { AccessDeniedCard } from '../components/access-denied-card'
import { AddHRNoteDialog } from '../components/add-hr-note-dialog'
import { ApplicationActionPanel } from '../components/application-action-panel'
import { ApplicationHistoryPanel } from '../components/application-history-panel'
import { ApplicationStaffNotesPanel } from '../components/application-staff-notes-panel'
import { ApplicationStatusBadge } from '../components/application-status-badge'
import { ApplicationTimeline } from '../components/application-timeline'
import { ApplicationCharacterStack } from '../components/application-character-stack'
import { FulcrumPanel } from '../components/fulcrum-panel'
import { HRNotesList } from '../components/hr-notes-list'
import { MessagesPanel } from '../components/messages-panel'
import { Button } from '@/components/ui/button'
import { RecommendationList } from '../components/recommendation-list'
import {
	useApplication,
	useApplicationActivity,
	useApplicationStaffNotes,
	useDeleteHRNote,
	useHRNotes,
	useHRNote,
	useMessageCount,
	useRecommendations,
} from '../hooks'

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
	const [searchParams] = useSearchParams()
	const initialTab = searchParams.get('tab') || 'details'
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { canAccess: hasCorporationAccess, isLoading: corporationAccessLoading } =
		useCanAccessCorporation(corporationId ?? '')

	// Dialog state for HR Notes
	const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false)
	const [editNoteDialogOpen, setEditNoteDialogOpen] = useState(false)
	const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
	const { showSuccess, showError } = useMessage()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const deleteHrNote = useDeleteHRNote()

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

	// Fetch activity log, recommendations, and message count
	const { data: activityLog, isLoading: activityLoading } = useApplicationActivity(applicationId!)
	const { data: recommendations } = useRecommendations(applicationId!)
	const { data: messageCount = 0 } = useMessageCount(applicationId!)
	const { data: staffNotes = [] } = useApplicationStaffNotes(applicationId!)
	const staffNotesCount = staffNotes.length
	const { data: globalUserNotes = [] } = useHRNotes(
		{ subjectUserId: application?.userId },
		{ enabled: !!application?.userId && (!!user?.is_admin || !!permission?.hasPermission) }
	)
	const globalUserNotesCount = globalUserNotes.length

	// Fetch selected HR note for edit/delete
	const { data: selectedNote } = useHRNote(selectedNoteId)

	// Resolve alt character names
	const altCharacterIds = application?.altCharacterIds ?? []
	const { data: altCharacterNames = {} } = useEntityNames(altCharacterIds, {
		enabled: altCharacterIds.length > 0,
	})

	// Fetch total SP for main character + alts
	const allCharacterIds = application
		? [application.characterId, ...altCharacterIds]
		: []
	const spQueries = useQueries({
		queries: allCharacterIds.map((charId) => ({
			queryKey: ['character', charId],
			queryFn: () => apiClient.getCharacterDetail(charId),
			enabled: !!application,
			staleTime: 5 * 60 * 1000,
		})),
	})
	const spByCharacterId: Record<string, number | null> = {}
	const walletByCharacterId: Record<string, string | null> = {}
	for (let i = 0; i < allCharacterIds.length; i++) {
		const query = spQueries[i]
		spByCharacterId[allCharacterIds[i]] = query?.data?.public?.skills?.totalSp ?? null
		walletByCharacterId[allCharacterIds[i]] = query?.data?.private?.wallet?.balance ?? null
	}

	// Set page title
	usePageTitle(
		application ? `Review Application - ${application.characterName}` : 'Review Application'
	)

	const applicationsPath = `/corporations/${corporationId}/applications`

	const handleAddNote = () => {
		setAddNoteDialogOpen(true)
	}

	const handleEditNote = (noteId: string) => {
		setSelectedNoteId(noteId)
		setEditNoteDialogOpen(true)
	}

	const handleDeleteNote = (noteId: string) => {
		const note = globalUserNotes.find((candidate) => candidate.id === noteId)
		if (!note) return

		requestConfirmation({
			title: 'Delete HR Note',
			description: 'Are you sure you want to delete this HR note? This action cannot be undone.',
			confirmLabel: 'Delete Note',
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteHrNote.mutateAsync({
						noteId: note.id,
						subjectUserId: note.subjectUserId,
					})
					showSuccess('HR note deleted successfully')
					setSelectedNoteId(null)
				} catch (error) {
					showError(error instanceof Error ? error.message : 'Failed to delete HR note')
				}
			},
		})
	}

	const handleNoteDialogSuccess = () => {
		setSelectedNoteId(null)
		// Refetch is handled by React Query cache invalidation
	}

	const showMembersNavigation = user?.is_admin || hasCorporationAccess
	const rootCorporationsPath = '/corporations'
	const rootCorporationsLabel = 'Corporations'
	const membersPath = `/corporations/${corporationId}/members`
	const reviewTabTriggerClassName = 'flex-1 sm:flex-none'

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check required params
	if (!corporationId || !applicationId) {
		return <Navigate to="/corporations" replace />
	}

	// Loading state
	if (authLoading || permissionLoading || applicationLoading || corporationAccessLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	// Access denied - no HR role
	// Check permission - site admins always have access
	if (!permission?.hasPermission && !user?.is_admin) {
		return (
			<Container>
				<AccessDeniedCard
					message="You don't have HR permissions for this corporation. Contact an HR Admin to request access."
					backLabel={`Back to ${rootCorporationsLabel}`}
					onBack={() => navigate(rootCorporationsPath)}
				/>
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
					backLabel="Back to Applications"
					backHref={applicationsPath}
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
						<Button asChild variant="ghost">
							<Link to={applicationsPath}>
								Back to Applications
							</Link>
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	// Verify application belongs to this corporation
	if (application.corporationId !== corporationId) {
		return (
			<Container>
				<AccessDeniedCard
					title="Invalid Application"
					message="This application does not belong to the specified corporation."
					backLabel="Back to Applications"
					backHref={applicationsPath}
				/>
			</Container>
		)
	}

	// Main content
	return (
		<Container>
			{/* Breadcrumb Navigation */}
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink to={rootCorporationsPath}>{rootCorporationsLabel}</BreadcrumbLink>
						</BreadcrumbItem>
						{showMembersNavigation && (
							<>
								<BreadcrumbSeparator />
								<BreadcrumbItem>
									<BreadcrumbLink to={membersPath}>Members</BreadcrumbLink>
								</BreadcrumbItem>
							</>
						)}
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink to={`/corporations/${corporationId}/applications`}>
								Applications
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{application.characterName}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>

				<Button asChild variant="ghost">
					<Link to={applicationsPath}>
						<ArrowLeft className="h-4 w-4" />
						Back to Applications
					</Link>
				</Button>
			</div>

			{/* Header Card */}
			<Card className="mb-6">
				<CardContent className="pt-6">
					<div className="flex items-start gap-4">
						{/* Character Portrait */}
						<ApplicationCharacterStack
							mainCharacterId={application.characterId}
							mainCharacterName={application.characterName}
							altCharacterIds={altCharacterIds}
							altCharacterNames={altCharacterNames}
							size="lg"
						/>

						{/* Application Header Info */}
						<div className="flex-1 min-w-0">
							<h1 className="text-2xl font-bold text-foreground mb-1">
								{application.characterName}
								{altCharacterIds.length > 0 && (
									<span className="ml-2 text-lg font-normal text-muted-foreground">
										(+{altCharacterIds.length} {altCharacterIds.length === 1 ? 'Alt' : 'Alts'})
									</span>
								)}
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
			<Tabs defaultValue={initialTab} className="space-y-6">
				<TabsList className="w-full sm:w-auto">
					<TabsTrigger
						value="details"
						className={reviewTabTriggerClassName}
					>
						Details
					</TabsTrigger>
					<TabsTrigger
						value="alts"
						className={reviewTabTriggerClassName}
					>
						Characters
						{altCharacterIds.length > 0 && (
							<span className="ml-1.5 text-xs opacity-70">({altCharacterIds.length})</span>
						)}
					</TabsTrigger>
					<TabsTrigger
						value="recommendations"
						className={reviewTabTriggerClassName}
					>
						Recommendations
						{recommendations && recommendations.length > 0 && (
							<span className="ml-1.5 text-xs opacity-70">({recommendations.length})</span>
						)}
					</TabsTrigger>
					<TabsTrigger
						value="history"
						className={reviewTabTriggerClassName}
					>
						History
					</TabsTrigger>
					<TabsTrigger
						value="messages"
						className={reviewTabTriggerClassName}
					>
						Messages
						{messageCount > 0 && (
							<span className="ml-1.5 text-xs opacity-70">({messageCount})</span>
						)}
					</TabsTrigger>
					{(user?.is_admin || permission?.hasPermission) && (
						<TabsTrigger
							value="staff-notes"
							className={reviewTabTriggerClassName}
						>
							Application Notes
							{staffNotesCount > 0 && (
								<span className="ml-1.5 text-xs opacity-70">({staffNotesCount})</span>
							)}
						</TabsTrigger>
					)}
					{(user?.is_admin || permission?.hasPermission) && (
						<TabsTrigger
							value="global-notes"
							className={reviewTabTriggerClassName}
						>
							Global User Notes
							<span className="ml-1.5 text-xs opacity-70">({globalUserNotesCount})</span>
						</TabsTrigger>
					)}
					<TabsTrigger
						value="prior-apps"
						className={reviewTabTriggerClassName}
					>
						Prior Apps
					</TabsTrigger>
					{permission?.currentRole && ['hr_admin', 'hr_reviewer'].includes(permission.currentRole) && application && ACTIVE_APPLICATION_STATUSES.includes(application.status) && (
						<TabsTrigger
							value="fulcrum"
							className={reviewTabTriggerClassName}
						>
							Fulcrum
						</TabsTrigger>
					)}
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
							<p className="text-foreground whitespace-pre-wrap break-words leading-relaxed">
								{application.applicationText}
							</p>
						</CardContent>
					</Card>

					{/* Review Information (shown for under_review, accepted, rejected) */}
					{application.reviewedAt &&
						(application.status === 'under_review' || application.status === 'accepted' || application.status === 'rejected') && (
							<Card className={application.status === 'under_review' ? 'border-primary/30 bg-primary/5' : undefined}>
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

					{/* HR Action Panel */}
					<ApplicationActionPanel
						application={application}
						userRole={permission?.currentRole || null}
						onStatusChange={() => {
							// Status change is handled by React Query cache invalidation
							// No need to manually refetch
						}}
					/>
				</TabsContent>

				{/* Alt Characters Tab */}
				<TabsContent value="alts" className="space-y-6">
					{/* Main Character */}
					<Card>
						<CardHeader>
							<CardTitle>Main Character</CardTitle>
							<CardDescription>
								The primary character for this application
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="flex items-center gap-3 rounded-md border p-3">
								<MemberAvatar
									characterId={application.characterId}
									characterName={application.characterName}
									size="md"
								/>
								<div>
									<p className="text-sm font-medium">
										{application.characterName}
									</p>
									<p className="text-xs text-muted-foreground">
										<span className="font-mono tabular-nums">
											{spByCharacterId[application.characterId] != null
												? formatSkillPoints(spByCharacterId[application.characterId]!)
												: 'SP unavailable'}
										</span>
										<span className="mx-2">—</span>
										<span className="font-mono tabular-nums">
											{walletByCharacterId[application.characterId] != null
												? formatISKShort(walletByCharacterId[application.characterId]!)
												: 'Wallet unavailable'}
										</span>
									</p>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Alt Characters */}
					<Card>
						<CardHeader>
							<CardTitle>Alt Characters</CardTitle>
							<CardDescription>
								Additional characters the applicant is applying with.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{altCharacterIds.length > 0 ? (
								<div className="space-y-3">
									{altCharacterIds.map((charId) => (
										<div key={charId} className="flex items-center gap-3 rounded-md border p-3">
											<MemberAvatar
												characterId={charId}
												characterName={altCharacterNames[charId] ?? charId}
												size="md"
											/>
											<div className="flex-1 min-w-0">
												<p className="text-sm font-medium">
													{altCharacterNames[charId] ?? charId}
												</p>
												<p className="text-xs text-muted-foreground">
													<span className="font-mono tabular-nums">
														{spByCharacterId[charId] != null
															? formatSkillPoints(spByCharacterId[charId]!)
															: 'SP unavailable'}
													</span>
													<span className="mx-2">—</span>
													<span className="font-mono tabular-nums">
														{walletByCharacterId[charId] != null
															? formatISKShort(walletByCharacterId[charId]!)
															: 'Wallet unavailable'}
													</span>
												</p>
											</div>
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">No alt characters were included with this application.</p>
							)}
						</CardContent>
					</Card>
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
							<CardDescription>Communicate with the applicant</CardDescription>
						</CardHeader>
						<CardContent>
							<MessagesPanel
								applicationId={applicationId!}
								currentUserId={user!.id}
								recipientId={application.userId}
								corporationId={corporationId}
								canSend={['pending', 'under_review'].includes(application.status)}
								showTemplates={true}
							/>
						</CardContent>
					</Card>
				</TabsContent>

				{/* Staff Notes Tab */}
				{(user?.is_admin || permission?.hasPermission) && (
					<TabsContent value="staff-notes">
						<Card className="border-warning/30 bg-warning/5">
							<CardHeader>
								<div className="flex items-center gap-2">
									<Lock className="h-4 w-4 text-warning" />
									<CardTitle>Application Staff Notes</CardTitle>
								</div>
								<CardDescription>
									Private notes scoped to this application. Only visible to HR staff.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<ApplicationStaffNotesPanel
									applicationId={applicationId!}
									canWrite={!!user?.is_admin || !!permission?.hasPermission}
									currentUserId={user?.id ?? null}
								/>
							</CardContent>
						</Card>
					</TabsContent>
				)}

				{/* Global Notes Tab */}
				{(user?.is_admin || permission?.hasPermission) && (
					<TabsContent value="global-notes">
						<Card className="border-warning/30 bg-warning/5">
							<CardHeader>
								<div className="flex items-center gap-2">
									<Lock className="h-4 w-4 text-warning" />
									<CardTitle>Global HR Notes</CardTitle>
								</div>
								<CardDescription>
									Private internal notes about this user across all applications. Only visible to HR staff.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<HRNotesList
									subjectUserId={application.userId}
									subjectCharacterName={application.characterName}
									onAddNote={handleAddNote}
									onEditNote={user?.is_admin ? handleEditNote : undefined}
									onDeleteNote={user?.is_admin ? handleDeleteNote : undefined}
									hasAccess
								/>
							</CardContent>
						</Card>
					</TabsContent>
				)}

				{/* Prior Applications Tab */}
				<TabsContent value="prior-apps">
					<Card>
						<CardHeader>
							<CardTitle>Prior Applications</CardTitle>
							<CardDescription>
								Applications by this character (across all accounts) and other characters on this account
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ApplicationHistoryPanel
								characterId={application.characterId}
								userId={application.userId}
								applicationId={applicationId!}
							/>
						</CardContent>
					</Card>
				</TabsContent>

				{/* Fulcrum (Character Reports) Tab */}
				{permission?.currentRole && ['hr_admin', 'hr_reviewer'].includes(permission.currentRole) && application && ACTIVE_APPLICATION_STATUSES.includes(application.status) && (
					<TabsContent value="fulcrum">
						<Card>
							<CardHeader>
								<CardTitle>Character Reports</CardTitle>
								<CardDescription>
									Generate detailed background reports for {application.characterName}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<FulcrumPanel
									userId={application.userId}
									corporationId={application.corporationId}
									applicationId={applicationId!}
									mainCharacterId={application.characterId}
									altCharacterIds={altCharacterIds}
								/>
							</CardContent>
						</Card>
					</TabsContent>
				)}
			</Tabs>

			{/* HR Notes Dialogs */}
			{(user?.is_admin || permission?.hasPermission) && (
				<AddHRNoteDialog
					open={addNoteDialogOpen}
					onOpenChange={setAddNoteDialogOpen}
					subjectUserId={application.userId}
					subjectCharacterId={application.characterId}
					subjectCharacterName={application.characterName}
					onSuccess={handleNoteDialogSuccess}
				/>
			)}

			{user?.is_admin && (
				<AddHRNoteDialog
					open={editNoteDialogOpen}
					onOpenChange={setEditNoteDialogOpen}
					subjectUserId={application.userId}
					subjectCharacterId={selectedNote?.subjectCharacterId || application.characterId}
					subjectCharacterName={selectedNote?.subjectCharacterName || application.characterName}
					existingNote={selectedNote}
					onSuccess={handleNoteDialogSuccess}
				/>
			)}
			{confirmationDialog}
		</Container>
	)
}
