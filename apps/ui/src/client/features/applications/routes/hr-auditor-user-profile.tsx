import { useQueries, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, ExternalLink, FileText, Plus, Scan, Shield, User, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import { MemberAvatar } from '@/components/member-avatar'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { apiClient } from '@/lib/api'
import { cn } from '@/lib/utils'

import { ApplicationStatusBadge } from '../components/application-status-badge'
import { AddHRNoteDialog } from '../components/add-hr-note-dialog'
import { CharacterIdentitySummary } from '../components/character-identity-summary'
import { useApplications, useHRNotes, useRequestFulcrumReport, useRequestFulcrumReportBatch } from '../hooks'
import { auditorUserKeys, useAuditorFulcrum, useAuditorUser } from '../../../hooks/useAuditorUsers'

import type { CharacterReportMetadata, FulcrumCharacterData } from '../api'

interface AuditorProfileNavigationState {
	source?: 'applications' | 'members'
	returnTo?: string
	corporationId?: string
}

interface AuditorCharacterRow {
	characterId: string
	characterName: string
	isPrimary: boolean
	corporationId: string | null
	corporationName: string | null
	allianceId: string | null
	allianceName: string | null
	role: 'CEO' | 'Director' | 'Member' | null
	activityStatus: 'active' | 'inactive' | 'unknown' | null
	hasValidToken: boolean | null
	latestReport: CharacterReportMetadata | null
	hasPendingReport: boolean
}

const SCAN_ALL_SEND_DM_PREF_KEY = 'fulcrum:scan-all:send-dm'

function getInitialScanAllSendDm(): boolean {
	if (typeof window === 'undefined') return true
	const raw = window.localStorage.getItem(SCAN_ALL_SEND_DM_PREF_KEY)
	return raw === null ? true : raw === 'true'
}

function getLatestReport(character: FulcrumCharacterData): CharacterReportMetadata | null {
	if (character.reports.length === 0) return null
	return character.reports.reduce((latest, report) =>
		new Date(report.createdAt) > new Date(latest.createdAt) ? report : latest
	)
}

export default function HrAuditorUserProfilePage() {
	const { userId } = useParams<{ userId: string }>()
	const location = useLocation()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')
	const [requestingCharacterId, setRequestingCharacterId] = useState<string | null>(null)
	const [isScanningAll, setIsScanningAll] = useState(false)
	const [scanAllDialogOpen, setScanAllDialogOpen] = useState(false)
	const [singleScanDialogCharacter, setSingleScanDialogCharacter] = useState<AuditorCharacterRow | null>(null)
	const [sendDmForScanRequests, setSendDmForScanRequests] = useState(getInitialScanAllSendDm)
	const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false)

	const { data: userDetails, isLoading: userLoading } = useAuditorUser(userId ?? '')
	const { data: fulcrumCharacters, isLoading: fulcrumLoading } = useAuditorFulcrum(userId ?? '', !!userId)
	const { data: notes, isLoading: notesLoading } = useHRNotes(
		userId ? { subjectUserId: userId } : undefined
	)
	const { data: applications, isLoading: appsLoading } = useApplications(
		userId ? { userId } : undefined
	)

	const requestReport = useRequestFulcrumReport()
	const requestReportBatch = useRequestFulcrumReportBatch()

	const mainCharacter = useMemo(() => {
		if (!userDetails) return null
		return userDetails.characters.find((c) => c.characterId === userDetails.mainCharacterId)
			?? userDetails.characters[0]
			?? null
	}, [userDetails])

	const accountName = mainCharacter?.characterName ?? userId ?? 'Unknown'
	const canAddNote = isAuditor || user?.is_admin === true
	usePageTitle(userDetails ? `${accountName} | Auditor` : 'Auditor Profile')

	const sortedApps = useMemo(() => {
		if (!applications) return []
		return [...applications].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		)
	}, [applications])

	const navigationState = location.state as AuditorProfileNavigationState | null
	const source = navigationState?.source
	const returnTo = navigationState?.returnTo
	const fromApplications = source === 'applications' || returnTo?.includes('/applications')
	const fromMembers = source === 'members' || returnTo?.includes('/members')
	const backTarget = returnTo ?? '/hr/users'
	const breadcrumbMidLabel = fromApplications ? 'Applications' : fromMembers ? 'Members' : 'User Search'
	const backLabel = fromApplications ? 'Back to Applications' : fromMembers ? 'Back to Members' : 'Back to User Search'

	const rows = useMemo<AuditorCharacterRow[]>(() => {
		if (!userDetails) return []

		const fulcrumMap = new Map((fulcrumCharacters ?? []).map((c) => [c.characterId, c]))
		return userDetails.characters
			.map((character) => {
				const fulcrum = fulcrumMap.get(character.characterId)
				const latestReport = fulcrum ? getLatestReport(fulcrum) : null
				const hasPendingReport =
					fulcrum?.reports.some((r) => r.status === 'pending' || r.status === 'processing') ?? false
				return {
					characterId: character.characterId,
					characterName: character.characterName,
					isPrimary: character.is_primary,
					corporationId: fulcrum?.corporationId ?? null,
					corporationName: fulcrum?.corporationName ?? null,
					allianceId: fulcrum?.allianceId ?? null,
					allianceName: fulcrum?.allianceName ?? null,
					role: fulcrum?.role ?? null,
					activityStatus: fulcrum?.activityStatus ?? null,
					latestReport,
					hasPendingReport,
					hasValidToken: fulcrum?.hasValidToken ?? null,
				}
			})
			.sort((a, b) => {
				if (a.isPrimary && !b.isPrimary) return -1
				if (!a.isPrimary && b.isPrimary) return 1
				return a.characterName.localeCompare(b.characterName)
			})
	}, [fulcrumCharacters, userDetails])

	const characterDetailQueries = useQueries({
		queries: rows.map((character) => ({
			queryKey: ['character', character.characterId, 'auditor-profile', character.corporationId],
			queryFn: () => apiClient.getCharacterDetail(character.characterId, character.corporationId ?? undefined),
			enabled: !!character.corporationId,
			staleTime: 5 * 60 * 1000,
		})),
	})
	const spByCharacterId = new Map<string, number | null>()
	const walletByCharacterId = new Map<string, string | null>()
	const metricsLoadingByCharacterId = new Map<string, boolean>()
	rows.forEach((character, index) => {
		const query = characterDetailQueries[index]
		const detail = query?.data
		spByCharacterId.set(character.characterId, detail?.public?.skills?.totalSp ?? null)
		walletByCharacterId.set(character.characterId, detail?.private?.wallet?.balance ?? null)
		metricsLoadingByCharacterId.set(
			character.characterId,
			!!character.corporationId && (query?.isPending ?? false) && detail == null
		)
	})

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if (authLoading || userLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[320px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	if (!isAuditor && !user?.is_admin) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">Access Denied</CardTitle>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	if (!userDetails) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto">
					<CardHeader className="text-center">
						<CardTitle>User Not Found</CardTitle>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="ghost" asChild>
							<Link to={backTarget}>
								<ArrowLeft className="h-4 w-4" />
								{backLabel}
							</Link>
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	const handleRequestReport = (character: AuditorCharacterRow, sendDm: boolean) => {
		if (
			!character.corporationId ||
			!userId ||
			isScanningAll ||
			requestReportBatch.isPending ||
			character.hasPendingReport
		) {
			return
		}
		setRequestingCharacterId(character.characterId)
		requestReport.mutate(
			{
				characterId: character.characterId,
				corporationId: character.corporationId,
				requestSource: 'hr',
				targetUserId: userId,
				userId,
				sendDm,
			},
			{
				onSettled: () => {
					void queryClient.invalidateQueries({
						queryKey: auditorUserKeys.fulcrum(userId),
					})
					setRequestingCharacterId(null)
				},
			}
		)
	}

	const handleViewDetails = (character: AuditorCharacterRow) => {
		navigate(`/character/${character.characterId}`, {
			state: {
				backTo: `/hr/users/${userId}`,
				backLabel: 'Back to User Details',
			},
		})
	}

	const handleViewLatestReport = (character: AuditorCharacterRow) => {
		if (character.latestReport?.status !== 'completed' || !character.corporationId) return
		const returnTo = `${location.pathname}${location.search}`
		navigate(`/hr/users/${userId}/reports/${character.latestReport.id}`, {
			state: {
				characterName: character.characterName,
				userId: userId ?? undefined,
				corporationId: character.corporationId,
				returnTo,
				backLabel: 'Back to User Profile',
				breadcrumbParentLabel: 'User Profile',
			},
		})
	}

	const scanEligibleCharacters = rows.filter(
		(character) => !!character.corporationId && !character.hasPendingReport
	)

	const handleScanAllCharacters = async (sendDm: boolean) => {
		if (!userId || scanEligibleCharacters.length === 0) return
		setIsScanningAll(true)
		try {
			const groups = new Map<string, string[]>()
			for (const character of scanEligibleCharacters) {
				const corporationId = character.corporationId
				if (!corporationId) continue
				const existing = groups.get(corporationId)
				if (existing) {
					existing.push(character.characterId)
				} else {
					groups.set(corporationId, [character.characterId])
				}
			}

			let sentDmForAnyBatch = false
			for (const [corporationId, characterIds] of groups.entries()) {
				const sendDmForBatch = sendDm && !sentDmForAnyBatch
				await requestReportBatch.mutateAsync({
					characterIds,
					corporationId,
					requestSource: 'hr',
					userId,
					targetUserId: userId,
					sendDm: sendDmForBatch,
				})
				if (sendDmForBatch) {
					sentDmForAnyBatch = true
				}
			}
		} finally {
			void queryClient.invalidateQueries({
				queryKey: auditorUserKeys.fulcrum(userId),
			})
			setIsScanningAll(false)
		}
	}

	const handleOpenScanAllDialog = () => {
		if (isScanningAll || requestReport.isPending || requestReportBatch.isPending || scanEligibleCharacters.length === 0) return
		setScanAllDialogOpen(true)
	}

	const handleConfirmScanAll = () => {
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(SCAN_ALL_SEND_DM_PREF_KEY, sendDmForScanRequests ? 'true' : 'false')
		}
		setScanAllDialogOpen(false)
		void handleScanAllCharacters(sendDmForScanRequests)
	}

	const handleOpenSingleScanDialog = (character: AuditorCharacterRow) => {
		if (!character.corporationId || isScanningAll || character.hasPendingReport) return
		setSingleScanDialogCharacter(character)
	}

	const handleConfirmSingleScan = () => {
		if (!singleScanDialogCharacter) return
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(SCAN_ALL_SEND_DM_PREF_KEY, sendDmForScanRequests ? 'true' : 'false')
		}
		const character = singleScanDialogCharacter
		setSingleScanDialogCharacter(null)
		handleRequestReport(character, sendDmForScanRequests)
	}

	return (
		<Container>
			<div className="flex items-center justify-between mb-6">
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink to="/corporations">Corporations</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink to={backTarget}>{breadcrumbMidLabel}</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{accountName}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
				<Button variant="ghost" asChild>
					<Link to={backTarget}>
						<ArrowLeft className="h-4 w-4" />
						{backLabel}
					</Link>
				</Button>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
				<div className="space-y-4 lg:sticky lg:top-8 lg:self-start">
					<Card>
						<CardContent className="pt-6">
							<div className="flex flex-col items-center text-center space-y-3">
								{mainCharacter && (
									<MemberAvatar
										characterId={mainCharacter.characterId}
										characterName={mainCharacter.characterName}
										size="lg"
									/>
								)}
								<div className="space-y-1">
									<h1 className="text-xl font-bold">{accountName}</h1>
									<p className="font-mono text-xs text-muted-foreground">User ID: {userDetails.id}</p>
								</div>
								<div className="flex items-center gap-2">
									{userDetails.is_admin && (
										<Badge variant="default" className="gap-1">
											<Shield className="h-3 w-3" />
											Site Admin
										</Badge>
									)}
									{userDetails.discordUserId ? (
										<Badge variant="success">Discord Linked</Badge>
									) : (
										<Badge variant="secondary">No Discord</Badge>
									)}
								</div>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardContent className="pt-6 space-y-3">
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">Characters</span>
								<span className="font-medium">{rows.length}</span>
							</div>
							<Separator />
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">Groups</span>
								<span className="font-medium">{userDetails.groupMemberships.length}</span>
							</div>
							<Separator />
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">Created</span>
								<span className="font-medium">
									{formatDistanceToNow(new Date(userDetails.createdAt), { addSuffix: true })}
								</span>
							</div>
							<Separator />
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">Updated</span>
								<span className="font-medium">
									{formatDistanceToNow(new Date(userDetails.updatedAt), { addSuffix: true })}
								</span>
							</div>
						</CardContent>
					</Card>

					<Button variant="ghost" asChild className="w-full">
						<Link to={`/hr/users/${userDetails.id}/groups`}>
							<Users className="h-4 w-4" />
							View Group Memberships
						</Link>
					</Button>
				</div>

				<div className="space-y-6">
					<Card>
				<CardHeader>
					<div className="flex items-center justify-between gap-2">
						<CardTitle className="flex items-center gap-2 text-base">
							<Users className="h-4 w-4" />
							Characters ({rows.length})
						</CardTitle>
						<Button
							variant="ghost"
							size="sm"
								onClick={handleOpenScanAllDialog}
							disabled={isScanningAll || requestReport.isPending || requestReportBatch.isPending || scanEligibleCharacters.length === 0}
						>
							<Scan className={`mr-1.5 h-3.5 w-3.5 ${isScanningAll ? 'animate-spin' : ''}`} />
							{isScanningAll
								? 'Scanning All...'
								: `Scan All (${scanEligibleCharacters.length})`}
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{fulcrumLoading ? (
						<div className="flex justify-center py-6">
							<LoadingSpinner size="sm" />
						</div>
					) : rows.length === 0 ? (
						<p className="text-sm text-muted-foreground text-center py-6">No linked characters found</p>
					) : (
						<div className="space-y-2">
							{rows.map((character) => {
								const isRequestingThisCharacter =
									requestReport.isPending && requestingCharacterId === character.characterId
								return (
									<div
										key={character.characterId}
										className="rounded-lg border px-3 py-2 space-y-2"
									>
										<CharacterIdentitySummary
											characterId={character.characterId}
											characterName={character.characterName}
											hasValidToken={character.hasValidToken}
											corporationId={character.corporationId}
											corporationName={character.corporationName}
											allianceId={character.allianceId}
											allianceName={character.allianceName}
											skillPoints={spByCharacterId.get(character.characterId)}
											walletBalance={walletByCharacterId.get(character.characterId)}
											isMetricsLoading={metricsLoadingByCharacterId.get(character.characterId)}
											nameBadges={
												<>
													{character.isPrimary && (
														<Badge
															variant="default"
															className="bg-blue-500/20 text-blue-500 text-[10px] px-1.5 py-0"
														>
															Primary
														</Badge>
													)}
													{(character.role === 'CEO' || character.role === 'Director') && (
														<span
															className={cn(
																'text-xs',
																character.role === 'CEO' && 'font-bold text-yellow-500',
																character.role === 'Director' && 'font-semibold text-blue-400'
															)}
														>
															{character.role}
														</span>
													)}
													{character.activityStatus && character.activityStatus !== 'unknown' && (
														<Badge
															variant={
																character.activityStatus === 'active'
																	? 'success'
																	: character.activityStatus === 'inactive'
																		? 'destructive'
																		: 'secondary'
															}
															className="text-[10px] px-1.5 py-0"
														>
															{character.activityStatus}
														</Badge>
													)}
												</>
											}
										/>
										<div className="flex items-center gap-2 pl-11">
											<div
												className={cn(
													'flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md border min-w-0 flex-1',
													character.latestReport?.status === 'completed' &&
														character.corporationId &&
														'cursor-pointer hover:bg-muted/50 transition-colors'
												)}
												onClick={() => handleViewLatestReport(character)}
											>
												<Scan className="h-3 w-3 text-muted-foreground shrink-0" />
												<span className="font-medium text-muted-foreground shrink-0">
													Fulcrum Report
												</span>
												<span className="text-muted-foreground shrink-0">·</span>
												{character.latestReport ? (
													character.latestReport.status === 'completed' ? (
														<>
															<span className="truncate text-foreground">
																View latest report (
																{formatDistanceToNow(new Date(character.latestReport.createdAt), {
																	addSuffix: true,
																})}
																)
															</span>
															<ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
														</>
													) : character.latestReport.status === 'pending' ||
														character.latestReport.status === 'processing' ? (
														<span className="truncate text-muted-foreground">
															Processing... (
															{formatDistanceToNow(new Date(character.latestReport.createdAt), {
																addSuffix: true,
															})}
															)
														</span>
													) : (
														<span className="truncate text-muted-foreground">
															Failed (
															{formatDistanceToNow(new Date(character.latestReport.createdAt), {
																addSuffix: true,
															})}
															)
														</span>
													)
												) : (
													<span className="truncate text-muted-foreground">No report yet</span>
												)}
											</div>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => handleViewDetails(character)}
											>
												<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
												View Details
											</Button>
											<Button
												variant={character.latestReport ? 'ghost' : 'primary'}
												size="sm"
												disabled={
													isScanningAll ||
													!character.corporationId ||
													character.hasPendingReport ||
													requestReportBatch.isPending ||
													isRequestingThisCharacter
												}
												onClick={() => handleOpenSingleScanDialog(character)}
											>
												<Scan className="mr-1.5 h-3.5 w-3.5" />
												{isRequestingThisCharacter
													? 'Requesting...'
													: 'Scan'}
											</Button>
										</div>
									</div>
								)
							})}
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between gap-2">
						<CardTitle className="flex items-center gap-2 text-base">
							<FileText className="h-4 w-4" />
							Notes
						</CardTitle>
						{canAddNote && (
							<Button variant="ghost" size="sm" onClick={() => setAddNoteDialogOpen(true)}>
								<Plus className="mr-1.5 h-3.5 w-3.5" />
								Add Note
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					{notesLoading ? (
						<div className="flex justify-center py-6">
							<LoadingSpinner size="sm" />
						</div>
					) : notes && notes.length > 0 ? (
						<div className="space-y-3">
							{notes.map((note) => (
								<div key={note.id} className="rounded-lg border p-3 space-y-2">
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2">
											<Badge variant={note.authorIsAdmin ? 'default' : 'secondary'}>
												{note.authorIsAdmin || note.source === 'admin' ? 'Admin' : 'HR'}
											</Badge>
											<span className="text-xs text-muted-foreground">
												by {note.authorCharacterName}
											</span>
										</div>
										<span className="text-xs text-muted-foreground">
											{formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
										</span>
									</div>
									<p className="text-sm whitespace-pre-wrap">{note.noteText}</p>
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground text-center py-4">No notes for this user</p>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-base">
						<User className="h-4 w-4" />
						Application History
					</CardTitle>
				</CardHeader>
				<CardContent>
					{appsLoading ? (
						<div className="flex justify-center py-6">
							<LoadingSpinner size="sm" />
						</div>
					) : sortedApps.length > 0 ? (
						<div className="space-y-2">
							{sortedApps.map((application) => (
								<div
									key={application.id}
									className="flex items-center justify-between rounded-lg border p-3"
								>
									<div className="min-w-0">
										<Link
											to={`/corporations/${application.corporationId}/applications/${application.id}`}
											className="font-medium hover:underline text-sm"
										>
											{application.corporationName ?? `Corp ${application.corporationId}`}
										</Link>
										<p className="text-xs text-muted-foreground">
											{new Date(application.createdAt).toLocaleDateString()}
										</p>
									</div>
									<ApplicationStatusBadge status={application.status} />
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground text-center py-4">No application history</p>
					)}
				</CardContent>
			</Card>
				</div>
			</div>
			{userId && (
				<AddHRNoteDialog
					open={addNoteDialogOpen}
					onOpenChange={setAddNoteDialogOpen}
					subjectUserId={userId}
					subjectCharacterId={mainCharacter?.characterId}
					subjectCharacterName={mainCharacter?.characterName}
					onSuccess={() => {
						void queryClient.invalidateQueries({
							queryKey: ['applications', 'hr-notes'],
						})
					}}
				/>
			)}
			<Dialog open={scanAllDialogOpen} onOpenChange={setScanAllDialogOpen}>
				<DialogContent className="sm:max-w-[500px]">
					<DialogHeader>
						<DialogTitle>Generate Reports For All Eligible Characters?</DialogTitle>
						<DialogDescription>
							This will queue {scanEligibleCharacters.length} report
							{scanEligibleCharacters.length === 1 ? '' : 's'}.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<label
							htmlFor="scan-all-send-dm"
							className="flex cursor-pointer items-center gap-2 rounded-md border p-3"
						>
							<Checkbox
								id="scan-all-send-dm"
								checked={sendDmForScanRequests}
								onCheckedChange={(checked) => setSendDmForScanRequests(checked === true)}
							/>
							<div>
								<span className="text-sm font-medium leading-none">Send DM for report status</span>
							</div>
						</label>
					</div>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setScanAllDialogOpen(false)}>
							Cancel
						</Button>
						<Button variant="confirm" onClick={handleConfirmScanAll}>
							Generate Reports
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog open={singleScanDialogCharacter !== null} onOpenChange={(open) => !open && setSingleScanDialogCharacter(null)}>
				<DialogContent className="sm:max-w-[500px]">
					<DialogHeader>
						<DialogTitle>Generate Report For {singleScanDialogCharacter?.characterName ?? 'Character'}?</DialogTitle>
						<DialogDescription>
							This will queue one character report.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<label
							htmlFor="single-scan-send-dm"
							className="flex cursor-pointer items-center gap-2 rounded-md border p-3"
						>
							<Checkbox
								id="single-scan-send-dm"
								checked={sendDmForScanRequests}
								onCheckedChange={(checked) => setSendDmForScanRequests(checked === true)}
							/>
							<div>
								<span className="text-sm font-medium leading-none">Send DM for report status</span>
							</div>
						</label>
					</div>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setSingleScanDialogCharacter(null)}>
							Cancel
						</Button>
						<Button variant="confirm" onClick={handleConfirmSingleScan}>
							Generate Report
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Container>
	)
}
