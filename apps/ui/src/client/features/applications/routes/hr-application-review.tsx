/**
 * HR Application Review Page
 *
 * Full application review interface for HR staff.
 * Shows application details, timeline, and action panel for status changes.
 * Requires HR Viewer role minimum.
 */

import { AlertCircle, ArrowLeft, Briefcase, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router'

import { Badge } from '@/components/ui/badge'
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
import { LoadingSpinner } from '@/components/ui/loading'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/useAuth'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { formatRelativeTime as formatDistanceToNow } from '@/lib/date-utils'
import toast from '@/lib/toast'
import { cn } from '@/lib/utils'

import { useCanAccessCorporation } from '../../corporations/hooks'
import { useHrPermissionCheck } from '../../hr/hooks'
import { AccessDeniedCard } from '../components/access-denied-card'
import { AddHRNoteDialog } from '../components/add-hr-note-dialog'
import { ApplicationActionPanel } from '../components/application-action-panel'
import { ApplicationCharacterStack } from '../components/application-character-stack'
import { ApplicationHistoryPanel } from '../components/application-history-panel'
import { ApplicationStaffNotesPanel } from '../components/application-staff-notes-panel'
import { ApplicationStatusBadge } from '../components/application-status-badge'
import { ApplicationTimeline } from '../components/application-timeline'
import { CharacterIdentitySummary } from '../components/character-identity-summary'
import { FulcrumPanel } from '../components/fulcrum-panel'
import { HRNotesList } from '../components/hr-notes-list'
import { MessagesPanel } from '../components/messages-panel'
import { RecommendationList } from '../components/recommendation-list'
import { OPEN_APPLICATION_STATUSES } from '../constants'
import {
	useApplication,
	useApplicationActivity,
	useApplicationStaffNotes,
	useCharacterPrivateDetailsBulk,
	useDeleteHRNote,
	useHRNote,
	useHRNotes,
	useHrUserBlocklistStatus,
	useHrUserCharacters,
	useRecommendations,
} from '../hooks'
import { resolveApplicationActionRole } from '../utils/application-action-role'
import { canViewFulcrumTab } from '../utils/fulcrum-access'
import { getPrivateDataUnavailableMessage } from '../utils/private-data'

// ============================================================================
// Component
// ============================================================================

/**
 * HR Application Review page with full details and actions
 */
export default function HrApplicationReview() {
	const { t } = useAppTranslation()

	const { corporationId, applicationId } = useParams<{
		corporationId: string
		applicationId: string
	}>()
	const [searchParams] = useSearchParams()
	const tabStorageKey = `hr-application-review-tab:${corporationId ?? ''}:${applicationId ?? ''}`
	const [activeTab, setActiveTab] = useState(() => {
		const requestedTab = searchParams.get('tab')
		if (requestedTab) return requestedTab
		if (typeof window !== 'undefined') {
			return window.sessionStorage.getItem(tabStorageKey) ?? 'details'
		}
		return 'details'
	})
	const { user, isAuthenticated, isLoading: authLoading, permissions } = useAuth()
	const isAuditor = permissions.some((permission) => permission.urn === 'urn:hr:auditor')
	const {
		canAccess: hasCorporationAccess,
		isLoading: corporationAccessLoading,
		corporation: accessCorp,
		userRole: accessUserRole,
	} = useCanAccessCorporation(corporationId ?? '')
	const isMemberCorporation = accessCorp?.isMemberCorporation === true
	const canViewCorporationApplications = user?.is_admin === true || isAuditor || isMemberCorporation

	// Dialog state for HR Notes
	const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false)
	const [editNoteDialogOpen, setEditNoteDialogOpen] = useState(false)
	const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
	const [copiedCharacterIds, setCopiedCharacterIds] = useState<Set<string>>(new Set())
	const { showSuccess, showError } = useMessage()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const deleteHrNote = useDeleteHRNote()

	// Check HR permission (userId derived from authenticated session)
	const shouldCheckPermission =
		!!corporationId && canViewCorporationApplications && user?.is_admin !== true
	const { data: permission, isLoading: permissionLoading } = useHrPermissionCheck(
		shouldCheckPermission ? { corporationId } : null
	)

	// Fetch application data
	const {
		data: application,
		isLoading: applicationLoading,
		error: applicationError,
	} = useApplication(applicationId!, { enabled: canViewCorporationApplications })

	// Fetch activity log, recommendations, and message count
	const { data: activityLog, isLoading: activityLoading } = useApplicationActivity(applicationId!, {
		enabled: canViewCorporationApplications,
	})
	const { data: recommendations } = useRecommendations(applicationId!, {
		enabled: canViewCorporationApplications,
	})
	const messageCount = application?.messageCount ?? 0
	const { data: staffNotes = [] } = useApplicationStaffNotes(applicationId!, {
		enabled: canViewCorporationApplications,
	})
	const staffNotesCount = staffNotes.length
	const { data: globalUserNotes = [] } = useHRNotes(
		{ subjectUserId: application?.userId },
		{
			enabled:
				!!application?.userId &&
				!!canViewCorporationApplications &&
				(!!user?.is_admin || !!permission?.hasPermission),
		}
	)
	const globalUserNotesCount = globalUserNotes.length
	const { data: hrCharacters = [] } = useHrUserCharacters(application?.userId ?? '', {
		enabled: !!application?.userId && canViewCorporationApplications,
	})
	const { data: userBlocklistStatus } = useHrUserBlocklistStatus(application?.userId ?? '', {
		enabled: !!application?.userId && canViewCorporationApplications,
	})
	const canViewApplicationPrivateData =
		!!application &&
		canViewCorporationApplications &&
		(user?.is_admin === true ||
			isAuditor ||
			isMemberCorporation ||
			OPEN_APPLICATION_STATUSES.includes(application.status))
	const canShowFulcrumTab = canViewFulcrumTab({
		applicationStatus: application?.status,
		currentRole: permission?.currentRole,
		isAdmin: user?.is_admin === true,
	})
	const canShowStaffTabs = Boolean(user?.is_admin || permission?.hasPermission)

	useEffect(() => {
		if (typeof window === 'undefined') return
		window.sessionStorage.setItem(tabStorageKey, activeTab)
	}, [activeTab, tabStorageKey])

	useEffect(() => {
		const alwaysAvailableTabs = new Set([
			'details',
			'alts',
			'recommendations',
			'history',
			'messages',
			'prior-apps',
		])
		const isAvailable =
			alwaysAvailableTabs.has(activeTab) ||
			(canShowStaffTabs && (activeTab === 'staff-notes' || activeTab === 'global-notes')) ||
			(canShowFulcrumTab && activeTab === 'fulcrum')
		if (!isAvailable) setActiveTab('details')
	}, [activeTab, canShowFulcrumTab, canShowStaffTabs])
	const applicationActionRole = resolveApplicationActionRole({
		isSiteAdmin: user?.is_admin === true,
		corporationRole: accessUserRole,
		permissionRole: permission?.currentRole,
	})

	// Fetch selected HR note for edit/delete
	const { data: selectedNote } = useHRNote(selectedNoteId)

	// Resolve alt character names
	const altCharacters = application?.altCharacters ?? []
	const altCharacterIds = altCharacters.map((character) => character.characterId)
	const altCharacterNames = Object.fromEntries(
		altCharacters.map((character) => [character.characterId, character.characterName])
	)

	// Fetch total SP for main character + alts
	const allCharacterIds = application ? [application.characterId, ...altCharacterIds] : []
	const characterDetailQuery = useCharacterPrivateDetailsBulk(allCharacterIds, {
		enabled: canViewApplicationPrivateData,
	})
	const characterDetailById = new Map(
		(characterDetailQuery.data?.items ?? []).map((item) => [item.characterId, item])
	)
	const markCharacterNameCopied = async (characterId: string, characterName: string) => {
		if (!characterName.trim()) return
		try {
			await navigator.clipboard.writeText(characterName)
			setCopiedCharacterIds((prev) => {
				const next = new Set(prev)
				next.add(characterId)
				return next
			})
			toast.success(`${characterName} copied`)
		} catch {
			toast.error(t('hrpages.failedToCopyCharacterName'))
		}
	}
	const spByCharacterId: Record<string, number | null> = {}
	const walletByCharacterId: Record<string, string | null> = {}
	const metricsLoadingByCharacterId: Record<string, boolean> = {}
	const privateDataUnavailableNotes: string[] = []
	for (let i = 0; i < allCharacterIds.length; i++) {
		const characterId = allCharacterIds[i]
		const item = characterDetailById.get(characterId)
		const detail = item?.data
		spByCharacterId[characterId] = detail?.skills?.totalSp ?? null
		walletByCharacterId[characterId] = detail?.private?.wallet?.balance ?? null
		metricsLoadingByCharacterId[characterId] = characterDetailQuery.isFetching && detail == null
		const unavailableMessage = getPrivateDataUnavailableMessage(
			item?.status === 'forbidden'
				? { status: 403 }
				: item?.status === 'unavailable'
					? { status: 500 }
					: null
		)
		if (unavailableMessage) privateDataUnavailableNotes.push(unavailableMessage)
	}
	const privateDataUnavailableMessage = !canViewApplicationPrivateData
		? getPrivateDataUnavailableMessage({ status: 403 })
		: (privateDataUnavailableNotes[0] ?? null)
	const hrCharacterTokenStateById = new Map(
		hrCharacters.map((character) => [character.characterId, character.hasValidToken])
	)
	const hrCharacterById = new Map(
		hrCharacters.map((character) => [character.characterId, character])
	)
	const esiStateByCharacterId: Record<string, boolean | null> = {}
	for (const characterId of allCharacterIds) {
		esiStateByCharacterId[characterId] = hrCharacterTokenStateById.get(characterId) ?? null
	}

	// Set page title
	usePageTitle(
		application
			? t('hrpages.reviewApplicationValue1', { value1: application.characterName })
			: t('hrpages.reviewApplication')
	)

	const applicationsPath = `/corporations/${corporationId}/applications`
	const memberProfilePath = application ? `/hr/users/${application.userId}` : null
	const memberProfileState = application
		? {
				source: 'applications' as const,
				returnTo: `/corporations/${corporationId}/applications/${application.id}`,
				backLabel: t('hrpages.backToApplication'),
				breadcrumbParentLabel: t('hrpages.application'),
			}
		: null

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
			title: t('hrpages.deleteHrNote'),
			description: t('hrpages.areYouSureYouWantToDeleteThisHrNote'),
			confirmLabel: t('hrpages.deleteNote'),
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteHrNote.mutateAsync({
						noteId: note.id,
						subjectUserId: note.subjectUserId,
					})
					showSuccess(t('hrpages.hrNoteDeletedSuccessfully'))
					setSelectedNoteId(null)
				} catch (error) {
					showError(error instanceof Error ? error.message : t('hrpages.failedToDeleteHrNote'))
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
	const rootCorporationsLabel = t('hrpages.corporations')
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
	if (
		authLoading ||
		corporationAccessLoading ||
		(shouldCheckPermission && permissionLoading) ||
		(canViewCorporationApplications && applicationLoading)
	) {
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
	if (
		!canViewCorporationApplications ||
		(!permission?.hasPermission && !user?.is_admin && !isAuditor)
	) {
		return (
			<Container>
				<AccessDeniedCard
					message={t('hrpages.youDonTHaveHrPermissionsForThisCorporationContact')}
					backLabel={t('hrpages.backTo1', { value1: rootCorporationsLabel })}
					backHref={rootCorporationsPath}
				/>
			</Container>
		)
	}

	// Error state
	if (applicationError) {
		return (
			<Container>
				<AccessDeniedCard
					title={t('hrpages.failedToLoadApplication')}
					message={
						applicationError instanceof Error
							? applicationError.message
							: t('hrpages.anUnexpectedErrorOccurred')
					}
					backLabel={t('hrpages.backToApplications')}
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
						<CardTitle>{t('hrpages.applicationNotFound')}</CardTitle>
						<CardDescription>
							{t('hrpages.thisApplicationDoesnTExistOrHasBeenRemoved')}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button asChild variant="ghost">
							<Link to={applicationsPath}>{t('hrpages.backToApplications')}</Link>
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
					title={t('hrpages.invalidApplication')}
					message={t('hrpages.thisApplicationDoesNotBelongToTheSpecifiedCorporation')}
					backLabel={t('hrpages.backToApplications')}
					backHref={applicationsPath}
				/>
			</Container>
		)
	}

	const legacySearchParams = new URLSearchParams({
		characterIds: [application.characterId, ...altCharacterIds].join(','),
	})
	const legacyHistoryPath = `/hr/legacy-history?${legacySearchParams.toString()}`

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
									<BreadcrumbLink to={membersPath}>{t('hrpages.members')}</BreadcrumbLink>
								</BreadcrumbItem>
							</>
						)}
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink to={`/corporations/${corporationId}/applications`}>
								{t('hrpages.applications2')}
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{application.characterName}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>

				<div className="flex items-center gap-2">
					<Button asChild variant="ghost">
						<a href={legacyHistoryPath} target="_blank" rel="noreferrer">
							<Briefcase className="h-4 w-4" />
							{t('hrpages.legacyAppSearch')}
						</a>
					</Button>
					<Button asChild variant="ghost">
						<Link to={applicationsPath}>
							<ArrowLeft className="h-4 w-4" />
							{t('hrpages.backToApplications')}
						</Link>
					</Button>
				</div>
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
							blacklistedCharacterIds={[
								...(hrCharacterById.get(application.characterId)?.isBlacklisted
									? [application.characterId]
									: []),
								...altCharacterIds.filter((characterId) =>
									Boolean(hrCharacterById.get(characterId)?.isBlacklisted)
								),
							]}
							size="lg"
						/>

						{/* Application Header Info */}
						<div className="flex-1 min-w-0">
							<h1 className="mb-1 flex flex-wrap items-center gap-2 text-2xl font-bold text-foreground">
								{memberProfilePath && memberProfileState ? (
									<Link
										to={memberProfilePath}
										state={memberProfileState}
										className={cn(
											'truncate text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm',
											hrCharacterById.get(application.characterId)?.isBlacklisted && 'text-red-500'
										)}
									>
										{application.characterName}
									</Link>
								) : (
									<span
										className={cn(
											'min-w-0 truncate',
											hrCharacterById.get(application.characterId)?.isBlacklisted && 'text-red-500'
										)}
									>
										{application.characterName}
									</span>
								)}
								{application.isFirstApplication !== undefined && (
									<Badge
										variant={application.isFirstApplication ? 'success' : 'default'}
										className="h-5 shrink-0 px-1.5 text-[10px] font-semibold leading-none"
									>
										{application.isFirstApplication ? t('hrpages.first') : t('hrpages.repeat')}
									</Badge>
								)}
								{userBlocklistStatus?.isBlacklisted && (
									<Badge variant="destructive" className="h-5 shrink-0 px-1.5 text-[10px]">
										{t('hrpages.blocklisted')}
									</Badge>
								)}
								{altCharacterIds.length > 0 && (
									<span className="ml-2 text-lg font-normal text-muted-foreground">
										(+{altCharacterIds.length}{' '}
										{altCharacterIds.length === 1 ? t('hrpages.alt') : t('hrpages.alts')})
									</span>
								)}
							</h1>
							{application.corporationName && (
								<p className="text-lg text-muted-foreground mb-3">
									{t('hrpages.appliedTo')}
									<span className="font-medium">{application.corporationName}</span>
								</p>
							)}
							<div className="mb-3 text-sm text-muted-foreground">
								{t('hrpages.discordUsername')}{' '}
								<span className="font-medium text-foreground">
									{application.discordUsername
										? `@${application.discordUsername}`
										: t('hrpages.notLinked')}
								</span>
							</div>
							<div className="flex items-center gap-3">
								<ApplicationStatusBadge status={application.status} size="md" />
								<span className="text-sm text-muted-foreground">
									{t('hrpages.submitted')}{' '}
									{formatDistanceToNow(new Date(application.createdAt), { addSuffix: true })}
								</span>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Tabbed Content */}
			<Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
				<TabsList className="w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
					<TabsTrigger value="details" className={reviewTabTriggerClassName}>
						{t('hrpages.details')}
					</TabsTrigger>
					<TabsTrigger value="alts" className={reviewTabTriggerClassName}>
						{t('hrpages.characters')}
						{altCharacterIds.length > 0 && (
							<span className="ml-1.5 text-xs opacity-70">({altCharacterIds.length})</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="recommendations" className={reviewTabTriggerClassName}>
						{t('hrpages.recommendations')}
						{recommendations && recommendations.length > 0 && (
							<span className="ml-1.5 text-xs opacity-70">({recommendations.length})</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="history" className={reviewTabTriggerClassName}>
						{t('hrpages.history')}
					</TabsTrigger>
					<TabsTrigger value="messages" className={reviewTabTriggerClassName}>
						{t('hrpages.messages')}
						{messageCount > 0 && (
							<span className="ml-1.5 text-xs opacity-70">({messageCount})</span>
						)}
					</TabsTrigger>
					{(user?.is_admin || permission?.hasPermission) && (
						<TabsTrigger value="staff-notes" className={reviewTabTriggerClassName}>
							{t('hrpages.applicationNotes')}
							{staffNotesCount > 0 && (
								<span className="ml-1.5 text-xs opacity-70">({staffNotesCount})</span>
							)}
						</TabsTrigger>
					)}
					{(user?.is_admin || permission?.hasPermission) && (
						<TabsTrigger value="global-notes" className={reviewTabTriggerClassName}>
							{t('hrpages.accountNotes')}
							<span className="ml-1.5 text-xs opacity-70">({globalUserNotesCount})</span>
						</TabsTrigger>
					)}
					<TabsTrigger value="prior-apps" className={reviewTabTriggerClassName}>
						{t('hrpages.priorApps')}
					</TabsTrigger>
					{canShowFulcrumTab && (
						<TabsTrigger value="fulcrum" className={reviewTabTriggerClassName}>
							{t('hrpages.fulcrum')}
						</TabsTrigger>
					)}
				</TabsList>

				{/* Details Tab */}
				<TabsContent value="details" className="space-y-6">
					{/* Application Text */}
					<Card>
						<CardHeader>
							<CardTitle>{t('hrpages.applicationText')}</CardTitle>
							<CardDescription>
								{t('hrpages.theApplicantSMessageExplainingWhyTheyWantToJoin')}
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
						(application.status === 'under_review' ||
							application.status === 'accepted' ||
							application.status === 'rejected') && (
							<Card
								className={
									application.status === 'under_review'
										? 'border-primary/30 bg-primary/5'
										: undefined
								}
							>
								<CardHeader>
									<CardTitle>{t('hrpages.reviewInformation')}</CardTitle>
									<CardDescription>{t('hrpages.detailsAboutTheApplicationReview')}</CardDescription>
								</CardHeader>
								<CardContent className="space-y-3">
									<div>
										<p className="text-sm font-medium text-muted-foreground">
											{t('hrpages.reviewedBy')}
										</p>
										<p className="text-foreground">
											{application.reviewedByCharacterName || t('hrpages.unknown')}
										</p>
									</div>
									<Separator />
									<div>
										<p className="text-sm font-medium text-muted-foreground">
											{t('hrpages.reviewedAt')}
										</p>
										<p className="text-foreground">
											{formatDistanceToNow(new Date(application.reviewedAt), { addSuffix: true })}
										</p>
									</div>
									{application.reviewNotes && (
										<>
											<Separator />
											<div>
												<p className="text-sm font-medium text-muted-foreground">
													{t('hrpages.reviewNotes2')}
												</p>
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
						userRole={applicationActionRole}
						onStatusChange={() => {
							// Status change is handled by React Query cache invalidation
							// No need to manually refetch
						}}
					/>
				</TabsContent>

				{/* Alt Characters Tab */}
				<TabsContent value="alts" className="space-y-6">
					{privateDataUnavailableMessage && (
						<div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
							<div className="flex items-start gap-3">
								<AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
								<div className="space-y-1">
									<p className="font-medium">
										{t('hrpages.privateEsiDataIsHiddenForSomeCharacters')}
									</p>
									<p className="text-sm text-amber-800 dark:text-amber-200">
										{privateDataUnavailableMessage}
									</p>
								</div>
							</div>
						</div>
					)}
					{/* Main Character */}
					<Card>
						<CardHeader>
							<CardTitle>{t('hrpages.mainCharacter')}</CardTitle>
							<CardDescription>
								{t('hrpages.thePrimaryCharacterForThisApplication')}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="card-gradient rounded-md border border-border/50 bg-card p-3 shadow-elevated">
								<CharacterIdentitySummary
									characterId={application.characterId}
									characterName={application.characterName}
									isBlacklisted={Boolean(
										hrCharacterById.get(application.characterId)?.isBlacklisted
									)}
									hasValidToken={esiStateByCharacterId[application.characterId]}
									corporationId={
										hrCharacterById.get(application.characterId)?.corporationId ?? null
									}
									corporationName={
										hrCharacterById.get(application.characterId)?.corporationName ?? null
									}
									allianceId={hrCharacterById.get(application.characterId)?.allianceId ?? null}
									allianceName={hrCharacterById.get(application.characterId)?.allianceName ?? null}
									skillPoints={spByCharacterId[application.characterId]}
									walletBalance={walletByCharacterId[application.characterId]}
									isMetricsLoading={metricsLoadingByCharacterId[application.characterId]}
									enableCopyName
									isNameCopied={copiedCharacterIds.has(application.characterId)}
									nameBadges={
										hrCharacterById.get(application.characterId)?.isBlacklisted ? (
											<Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
												{t('hrpages.blocklisted')}
											</Badge>
										) : undefined
									}
									onCopyName={() =>
										void markCharacterNameCopied(application.characterId, application.characterName)
									}
								/>
							</div>
						</CardContent>
					</Card>

					{/* Alt Characters */}
					<Card>
						<CardHeader>
							<CardTitle>{t('hrpages.altCharacters')}</CardTitle>
							<CardDescription>
								{t('hrpages.additionalCharactersTheApplicantIsApplyingWith')}
							</CardDescription>
						</CardHeader>
						<CardContent>
							{altCharacterIds.length > 0 ? (
								<div className="space-y-3">
									{altCharacterIds.map((charId) => (
										<div
											key={charId}
											className="card-gradient rounded-md border border-border/50 bg-card p-3 shadow-elevated"
										>
											<CharacterIdentitySummary
												characterId={charId}
												characterName={altCharacterNames[charId] ?? charId}
												isBlacklisted={Boolean(hrCharacterById.get(charId)?.isBlacklisted)}
												hasValidToken={esiStateByCharacterId[charId]}
												corporationId={hrCharacterById.get(charId)?.corporationId ?? null}
												corporationName={hrCharacterById.get(charId)?.corporationName ?? null}
												allianceId={hrCharacterById.get(charId)?.allianceId ?? null}
												allianceName={hrCharacterById.get(charId)?.allianceName ?? null}
												skillPoints={spByCharacterId[charId]}
												walletBalance={walletByCharacterId[charId]}
												isMetricsLoading={metricsLoadingByCharacterId[charId]}
												nameBadges={
													hrCharacterById.get(charId)?.isBlacklisted ? (
														<Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
															{t('hrpages.blocklisted')}
														</Badge>
													) : undefined
												}
												enableCopyName
												isNameCopied={copiedCharacterIds.has(charId)}
												onCopyName={() =>
													void markCharacterNameCopied(charId, altCharacterNames[charId] ?? charId)
												}
											/>
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									{t('hrpages.noAltCharactersWereIncludedWithThisApplication')}
								</p>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* Recommendations Tab */}
				<TabsContent value="recommendations">
					<Card>
						<CardHeader>
							<CardTitle>{t('hrpages.recommendations')}</CardTitle>
							<CardDescription>
								{t(
									'hrpages.communityRecommendationsForThisApplicationAllRecommendationsVisibleToHr'
								)}
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
							<CardTitle>{t('hrpages.activityHistory')}</CardTitle>
							<CardDescription>
								{t('hrpages.timelineOfAllActionsAndStatusChangesForThisApplication')}
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
									{t('hrpages.noActivityRecordedYet')}
								</p>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* Messages Tab */}
				<TabsContent value="messages">
					<Card>
						<CardHeader>
							<CardTitle>{t('hrpages.messages')}</CardTitle>
							<CardDescription>{t('hrpages.communicateWithTheApplicant')}</CardDescription>
						</CardHeader>
						<CardContent>
							<MessagesPanel
								applicationId={applicationId!}
								currentUserId={user!.id}
								recipientId={application.userId}
								corporationId={corporationId}
								canSend={['pending', 'under_review', 'accepted'].includes(application.status)}
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
									<CardTitle>{t('hrpages.applicationStaffNotes')}</CardTitle>
								</div>
								<CardDescription>
									{t('hrpages.privateNotesScopedToThisApplicationOnlyVisibleToHr')}
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
									<CardTitle>{t('hrpages.accountNotes')}</CardTitle>
								</div>
								<CardDescription>
									{t('hrpages.privateInternalNotesAboutThisUserAcrossAllApplicationsOnly')}
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
							<CardTitle>{t('hrpages.priorApplications')}</CardTitle>
							<CardDescription>
								{t('hrpages.applicationsByThisCharacterAcrossAllAccountsAndOtherCharacters')}
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
				{canShowFulcrumTab && (
					<TabsContent value="fulcrum">
						<Card>
							<CardHeader>
								<CardTitle>{t('hrpages.characterReports')}</CardTitle>
								<CardDescription>
									{t('hrpages.generateDetailedBackgroundReportsFor')}
									{application.characterName}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<FulcrumPanel
									userId={application.userId}
									corporationId={application.corporationId}
									applicationId={applicationId!}
									mainCharacterId={application.characterId}
									altCharacterIds={altCharacterIds}
									enabled={OPEN_APPLICATION_STATUSES.includes(application.status)}
									canRequestCharacterReport={(character) =>
										user?.is_admin || character.role !== 'CEO'
									}
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
