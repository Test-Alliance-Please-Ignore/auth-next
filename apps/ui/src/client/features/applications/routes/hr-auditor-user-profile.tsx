import { useQueries, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, Scan, Shield, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'

import { MemberAvatar } from '@/components/member-avatar'
import { IpHistoryCard } from '@/components/ip-history-card'
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
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { apiClient } from '@/lib/api'
import { cn } from '@/lib/utils'

import { ApplicationStatusBadge } from '../components/application-status-badge'
import { AddHRNoteDialog } from '../components/add-hr-note-dialog'
import {
	ProfileApplicationHistorySection,
	ProfileCharactersSection,
	ProfileNotesSection,
} from '../components/user-profile-sections'
import {
	FulcrumBulkScanDialog,
	FulcrumSingleScanDialog,
	useFulcrumScanDmPreference,
} from '../components/fulcrum-scan-dialogs'
import { useApplications, useHRNotes, useRequestFulcrumReport, useRequestFulcrumReportBatch } from '../hooks'
import {
	auditorUserKeys,
	useAuditorFulcrum,
	useAuditorUser,
	useAuditorUserIpHistory,
} from '../../../hooks/useAuditorUsers'
import { myCorporationsApi } from '../../corporations/api'

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
	const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false)
	const {
		sendDmForScanRequests,
		setSendDmForScanRequests,
		persistSendDmPreference,
	} = useFulcrumScanDmPreference()

	const { data: userDetails, isLoading: userLoading } = useAuditorUser(userId ?? '')
	const { data: fulcrumCharacters, isLoading: fulcrumLoading } = useAuditorFulcrum(userId ?? '', !!userId)
	const { data: notes, isLoading: notesLoading } = useHRNotes(
		userId ? { subjectUserId: userId } : undefined
	)
	const { data: applications, isLoading: appsLoading } = useApplications(
		userId ? { userId } : undefined
	)
	const { data: ipHistoryData } = useAuditorUserIpHistory(userId ?? '')

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
	const canRequestCeoReports = user?.is_admin || isAuditor
	const canRequestCharacterReport = (character: {
		role?: 'CEO' | 'Director' | 'Member' | null
	}) => canRequestCeoReports || character.role !== 'CEO'
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
			queryKey: ['character', character.characterId, 'auditor-profile-private', character.corporationId],
			queryFn: () => apiClient.getCharacterPrivateDetail(character.characterId, character.corporationId ?? undefined),
			meta: {
				suppressErrorToast: true,
			},
			enabled: !!character.corporationId,
			staleTime: 5 * 60 * 1000,
		})),
	})
	const corporationIdsForMemberMeta = useMemo(
		() =>
			[...new Set(rows.map((row) => row.corporationId).filter((value): value is string => Boolean(value)))],
		[rows]
	)
	const memberAccountQueries = useQueries({
		queries: corporationIdsForMemberMeta.map((corporationId) => ({
			queryKey: ['corporation-member-account', corporationId, userId],
			queryFn: () => myCorporationsApi.getCorporationMemberAccount(corporationId, userId ?? ''),
			meta: {
				suppressErrorToast: true,
			},
			enabled: Boolean(userId && corporationId),
			staleTime: 60_000,
		})),
	})
	const memberMetaByCharacterId = useMemo(() => {
		const map = new Map<string, { joinDate?: string; lastLogin?: string; locationSystem?: string; locationRegion?: string }>()
		for (const query of memberAccountQueries) {
			const account = query.data?.account
			if (!account) continue
			for (const member of account.characters) {
				map.set(member.characterId, {
					joinDate: member.joinDate,
					lastLogin: member.lastLogin,
					locationSystem: member.locationSystem,
					locationRegion: member.locationRegion,
				})
			}
		}
		return map
	}, [memberAccountQueries])
	const spByCharacterId = new Map<string, number | null>()
	const walletByCharacterId = new Map<string, string | null>()
	const metricsLoadingByCharacterId = new Map<string, boolean>()
	rows.forEach((character, index) => {
		const query = characterDetailQueries[index]
		const detail = query?.data
		spByCharacterId.set(character.characterId, detail?.skills?.totalSp ?? null)
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
				source: 'hr-auditor-user-profile',
				backTo: `/hr/users/${userId}`,
				backLabel: 'Back to User Details',
				corporationId: character.corporationId ?? undefined,
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
		(character) =>
			!!character.corporationId && !character.hasPendingReport && (canRequestCeoReports || character.role !== 'CEO')
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
		persistSendDmPreference(sendDmForScanRequests)
		setScanAllDialogOpen(false)
		void handleScanAllCharacters(sendDmForScanRequests)
	}

	const handleOpenSingleScanDialog = (character: AuditorCharacterRow) => {
		if (!character.corporationId || isScanningAll || character.hasPendingReport) return
		setSingleScanDialogCharacter(character)
	}

	const handleConfirmSingleScan = () => {
		if (!singleScanDialogCharacter) return
		persistSendDmPreference(sendDmForScanRequests)
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
					<ProfileCharactersSection
						characters={rows.map((character) => ({
							characterId: character.characterId,
							characterName: character.characterName,
							hasValidToken: character.hasValidToken,
							corporationId: character.corporationId,
							corporationName: character.corporationName,
							allianceId: character.allianceId,
							allianceName: character.allianceName,
							role: character.role,
							activityStatus: character.activityStatus,
							isPrimary: character.isPrimary,
							latestReport: character.latestReport,
							hasPendingReport: character.hasPendingReport,
							skillPoints: spByCharacterId.get(character.characterId),
							walletBalance: walletByCharacterId.get(character.characterId),
							isMetricsLoading: metricsLoadingByCharacterId.get(character.characterId),
							joinDate: memberMetaByCharacterId.get(character.characterId)?.joinDate,
							lastLogin: memberMetaByCharacterId.get(character.characterId)?.lastLogin,
							locationSystem: memberMetaByCharacterId.get(character.characterId)?.locationSystem,
							locationRegion: memberMetaByCharacterId.get(character.characterId)?.locationRegion,
						}))}
						fulcrumLoading={fulcrumLoading}
						showViewDetailsButton
						isScanAllVisible
						isScanningAll={isScanningAll}
						scanAllLabel={isScanningAll ? 'Scanning All...' : `Scan All (${scanEligibleCharacters.length})`}
						scanAllDisabled={
							isScanningAll ||
							requestReport.isPending ||
							requestReportBatch.isPending ||
							scanEligibleCharacters.length === 0
						}
						onScanAll={handleOpenScanAllDialog}
						isScanPendingFor={(characterId) =>
							requestReport.isPending && requestingCharacterId === characterId
						}
						onViewReport={(character) => {
							const full = rows.find((row) => row.characterId === character.characterId)
							if (full) handleViewLatestReport(full)
						}}
						onViewDetails={(character) => {
							const full = rows.find((row) => row.characterId === character.characterId)
							if (full) handleViewDetails(full)
						}}
						onScan={(character) => {
							const full = rows.find((row) => row.characterId === character.characterId)
							if (full) handleOpenSingleScanDialog(full)
						}}
						canRequestCharacterReport={canRequestCharacterReport}
					/>

					<ProfileNotesSection
						notes={notes}
						loading={notesLoading}
						canAddNote={canAddNote}
						onAddNote={() => setAddNoteDialogOpen(true)}
					/>

					<ProfileApplicationHistorySection
						applications={sortedApps.map((application) => ({
							id: application.id,
							corporationId: application.corporationId,
							corporationName: application.corporationName,
							characterId: application.characterId,
							characterName: application.characterName,
							status: application.status,
							createdAt: application.createdAt,
						}))}
						loading={appsLoading}
						onOpenApplication={(application) =>
							navigate(`/corporations/${application.corporationId}/applications/${application.id}`)
						}
					/>
					<IpHistoryCard
						title="IP History"
						entries={ipHistoryData?.entries ?? []}
						buildHashInspectionLink={(ipHash) =>
							`/hr/ip-history/${encodeURIComponent(ipHash)}?userId=${encodeURIComponent(userDetails.id)}`
						}
					/>
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
			<FulcrumBulkScanDialog
				open={scanAllDialogOpen}
				onOpenChange={setScanAllDialogOpen}
				eligibleCount={scanEligibleCharacters.length}
				sendDmForScanRequests={sendDmForScanRequests}
				setSendDmForScanRequests={setSendDmForScanRequests}
				onConfirm={handleConfirmScanAll}
			/>
			<FulcrumSingleScanDialog
				open={singleScanDialogCharacter !== null}
				onOpenChange={(open) => !open && setSingleScanDialogCharacter(null)}
				characterName={singleScanDialogCharacter?.characterName ?? 'Character'}
				sendDmForScanRequests={sendDmForScanRequests}
				setSendDmForScanRequests={setSendDmForScanRequests}
				onConfirm={handleConfirmSingleScan}
			/>
		</Container>
	)
}
