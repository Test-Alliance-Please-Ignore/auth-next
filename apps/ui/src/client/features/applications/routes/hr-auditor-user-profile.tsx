import { useQueries, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, ArrowLeft, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router'

import { CopyableMetaPill } from '@/components/copyable-meta-pill'
import { IpHistoryCard } from '@/components/ip-history-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { apiClient } from '@/lib/api'

import { useAuditorUser, useAuditorUserIpHistory } from '../../../hooks/useAuditorUsers'
import { myCorporationsApi } from '../../corporations/api'
import { AddHRNoteDialog } from '../components/add-hr-note-dialog'
import {
	FulcrumBulkScanDialog,
	FulcrumSingleScanDialog,
	useFulcrumScanDmPreference,
} from '../components/fulcrum-scan-dialogs'
import {
	UserProfilePageShell,
	UserProfileStatRow,
	UserProfileStatsSeparator,
	UserProfileStatusBadge,
} from '../components/user-profile-page-shell'
import {
	ProfileApplicationHistorySection,
	ProfileCharactersSection,
	ProfileNotesSection,
} from '../components/user-profile-sections'
import {
	useApplications,
	useFulcrumUserReports,
	useHRNotes,
	useHrUserCharacters,
	useRequestFulcrumReport,
	useRequestFulcrumReportBatch,
} from '../hooks'
import { getPrivateDataUnavailableMessage } from '../utils/private-data'
import { getApplicationProfileNavigationFromReferrer } from '../utils/profile-navigation'

import type { CharacterReportMetadata, FulcrumCharacterReportData } from '../api'

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
	isBlacklisted: boolean
	latestReport: CharacterReportMetadata | null
	hasPendingReport: boolean
}

function getLatestReport(character: FulcrumCharacterReportData): CharacterReportMetadata | null {
	if (character.reports.length === 0) return null
	return character.reports.reduce((latest, report) =>
		new Date(report.createdAt) > new Date(latest.createdAt) ? report : latest
	)
}

export default function HrAuditorUserProfilePage() {
	const { userId } = useParams<{ userId: string }>()
	const location = useLocation()
	const queryClient = useQueryClient()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')
	const [requestingCharacterId, setRequestingCharacterId] = useState<string | null>(null)
	const [isScanningAll, setIsScanningAll] = useState(false)
	const [scanAllDialogOpen, setScanAllDialogOpen] = useState(false)
	const [singleScanDialogCharacter, setSingleScanDialogCharacter] =
		useState<AuditorCharacterRow | null>(null)
	const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false)
	const { sendDmForScanRequests, setSendDmForScanRequests, persistSendDmPreference } =
		useFulcrumScanDmPreference()

	const { data: userDetails, isLoading: userLoading } = useAuditorUser(userId ?? '')
	const { data: hrCharacters = [], isLoading: hrLoading } = useHrUserCharacters(userId ?? '', {
		enabled: !!userId,
	})
	const { data: reportCharacters = [], isLoading: fulcrumLoading } = useFulcrumUserReports(
		userId ?? '',
		!!userId
	)
	const hrCharacterById = useMemo(
		() => new Map(hrCharacters.map((character) => [character.characterId, character])),
		[hrCharacters]
	)
	const reportCharacterById = useMemo(
		() => new Map(reportCharacters.map((character) => [character.characterId, character])),
		[reportCharacters]
	)
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
		return (
			userDetails.characters.find((c) => c.characterId === userDetails.mainCharacterId) ??
			userDetails.characters[0] ??
			null
		)
	}, [userDetails])

	const accountName = mainCharacter?.characterName ?? userId ?? 'Unknown'
	const canAddNote = isAuditor || user?.is_admin === true
	const canRequestCeoReports = user?.is_admin || isAuditor
	const canRequestCharacterReport = (character: { role?: 'CEO' | 'Director' | 'Member' | null }) =>
		canRequestCeoReports || character.role !== 'CEO'
	usePageTitle(userDetails ? `${accountName} | Auditor` : 'Auditor Profile')

	const sortedApps = useMemo(() => {
		if (!applications) return []
		return [...applications].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		)
	}, [applications])

	const [referrerNavigationState] = useState(getApplicationProfileNavigationFromReferrer)
	const navigationState =
		(location.state as AuditorProfileNavigationState | null) ?? referrerNavigationState
	const source = navigationState?.source
	const returnTo = navigationState?.returnTo
	const fromApplications = source === 'applications' || returnTo?.includes('/applications')
	const fromMembers = source === 'members' || returnTo?.includes('/members')
	const backTarget = returnTo ?? '/hr/users'
	const breadcrumbMidLabel = fromApplications
		? 'Applications'
		: fromMembers
			? 'Members'
			: 'User Search'
	const backLabel = fromApplications
		? 'Back to Applications'
		: fromMembers
			? 'Back to Members'
			: 'Back to User Search'

	const rows = useMemo<AuditorCharacterRow[]>(() => {
		if (!userDetails) return []

		const userCharacterById = new Map(
			userDetails.characters.map((character) => [character.characterId, character])
		)
		const allCharacterIds = new Set<string>([
			...userDetails.characters.map((character) => character.characterId),
			...hrCharacters.map((character) => character.characterId),
		])

		return [...allCharacterIds]
			.map((characterId) => {
				const userCharacter = userCharacterById.get(characterId)
				const hrCharacter = hrCharacterById.get(characterId)
				const reportCharacter = reportCharacterById.get(characterId)
				const latestReport = reportCharacter ? getLatestReport(reportCharacter) : null
				const hasPendingReport =
					reportCharacter?.reports.some(
						(r) => r.status === 'pending' || r.status === 'processing'
					) ?? false

				return {
					characterId,
					characterName: userCharacter?.characterName ?? hrCharacter?.characterName ?? characterId,
					isPrimary: userCharacter?.is_primary ?? characterId === userDetails.mainCharacterId,
					corporationId: hrCharacter?.corporationId ?? null,
					corporationName: hrCharacter?.corporationName ?? null,
					allianceId: hrCharacter?.allianceId ?? null,
					allianceName: hrCharacter?.allianceName ?? null,
					role: reportCharacter?.role ?? null,
					activityStatus: reportCharacter?.activityStatus ?? null,
					isBlacklisted: userCharacter?.isBlacklisted ?? hrCharacter?.isBlacklisted ?? false,
					latestReport,
					hasPendingReport,
					hasValidToken: userCharacter?.hasValidToken ?? hrCharacter?.hasValidToken ?? null,
				}
			})
			.sort((a, b) => {
				if (a.isPrimary && !b.isPrimary) return -1
				if (!a.isPrimary && b.isPrimary) return 1
				return a.characterName.localeCompare(b.characterName)
			})
	}, [hrCharacterById, hrCharacters, reportCharacterById, userDetails])

	const characterDetailQueries = useQueries({
		queries: rows.map((character) => ({
			queryKey: ['character', character.characterId, 'auditor-profile-private'],
			queryFn: () => apiClient.getCharacterPrivateDetail(character.characterId),
			meta: {
				suppressErrorToast: true,
			},
			enabled: !!character.characterId,
			staleTime: 5 * 60 * 1000,
		})),
	})
	const corporationIdsForMemberMeta = useMemo(
		() => [
			...new Set(
				rows.map((row) => row.corporationId).filter((value): value is string => Boolean(value))
			),
		],
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
		const map = new Map<
			string,
			{ joinDate?: string; lastLogin?: string; locationSystem?: string; locationRegion?: string }
		>()
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
	const privateDataUnavailableNoteByCharacterId = new Map<string, string | null>()
	rows.forEach((character, index) => {
		const query = characterDetailQueries[index]
		const detail = query?.data
		spByCharacterId.set(character.characterId, detail?.skills?.totalSp ?? null)
		walletByCharacterId.set(character.characterId, detail?.private?.wallet?.balance ?? null)
		metricsLoadingByCharacterId.set(
			character.characterId,
			!!character.corporationId && (query?.isPending ?? false) && detail == null
		)
		privateDataUnavailableNoteByCharacterId.set(
			character.characterId,
			getPrivateDataUnavailableMessage(query?.error)
		)
	})
	const privateDataUnavailableMessage =
		[...privateDataUnavailableNoteByCharacterId.values()].find((note) => Boolean(note)) ?? null

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if ((authLoading || userLoading || hrLoading || fulcrumLoading) && rows.length === 0) {
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
					setRequestingCharacterId(null)
				},
			}
		)
	}

	const scanEligibleCharacters = rows.filter(
		(character) =>
			!!character.corporationId &&
			!character.hasPendingReport &&
			(canRequestCeoReports || character.role !== 'CEO')
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
			setIsScanningAll(false)
		}
	}

	const handleOpenScanAllDialog = () => {
		if (
			isScanningAll ||
			requestReport.isPending ||
			requestReportBatch.isPending ||
			scanEligibleCharacters.length === 0
		)
			return
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
		<UserProfilePageShell
			rootLabel="Corporations"
			rootTo="/corporations"
			midLabel={breadcrumbMidLabel}
			backTarget={backTarget}
			backLabel={backLabel}
			accountName={accountName}
			userId={userDetails.id}
			mainCharacterId={mainCharacter?.characterId}
			mainCharacterName={mainCharacter?.characterName}
			isMainCharacterBlacklisted={Boolean(mainCharacter?.isBlacklisted)}
			isAccountBlacklisted={Boolean(userDetails.isBlacklisted)}
			sidebarBadges={
				<>
					{userDetails.is_admin && (
						<UserProfileStatusBadge variant="default">Site Admin</UserProfileStatusBadge>
					)}
					{userDetails.isBlacklisted && (
						<UserProfileStatusBadge variant="destructive">Blocklisted</UserProfileStatusBadge>
					)}
					{userDetails.discordUserId ? (
						<UserProfileStatusBadge variant="success">Discord Linked</UserProfileStatusBadge>
					) : (
						<UserProfileStatusBadge variant="secondary">No Discord</UserProfileStatusBadge>
					)}
					{(userDetails.discord?.username || userDetails.discordUserId) && (
						<div className="mt-2 flex flex-wrap items-center justify-center gap-2">
							{userDetails.discord?.username ? (
								<CopyableMetaPill label="Discord username" value={userDetails.discord.username} />
							) : null}
							{userDetails.discordUserId ? (
								<CopyableMetaPill label="Discord ID" value={userDetails.discordUserId} />
							) : null}
						</div>
					)}
				</>
			}
			sidebarStats={
				<>
					<UserProfileStatRow label="Characters" value={rows.length} />
					<UserProfileStatsSeparator />
					<UserProfileStatRow label="Groups" value={userDetails.groupMemberships.length} />
					<UserProfileStatsSeparator />
					<UserProfileStatRow
						label="Created"
						value={formatDistanceToNow(new Date(userDetails.createdAt), { addSuffix: true })}
					/>
					<UserProfileStatsSeparator />
					<UserProfileStatRow
						label="Updated"
						value={formatDistanceToNow(new Date(userDetails.updatedAt), { addSuffix: true })}
					/>
				</>
			}
			sidebarFooter={
				<Button variant="ghost" asChild className="w-full">
					<Link to={`/hr/users/${userDetails.id}/groups`}>
						<Users className="h-4 w-4" />
						View Group Memberships
					</Link>
				</Button>
			}
		>
			<>
				<div className="space-y-6">
					{privateDataUnavailableMessage && (
						<div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
							<div className="flex items-start gap-3">
								<AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
								<div className="space-y-1">
									<p className="font-medium">Private ESI data is hidden for some characters</p>
									<p className="text-sm text-amber-800 dark:text-amber-200">
										{privateDataUnavailableMessage}
									</p>
								</div>
							</div>
						</div>
					)}
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
							isBlacklisted: character.isBlacklisted,
							latestReport: character.latestReport,
							hasPendingReport: character.hasPendingReport,
							skillPoints: spByCharacterId.get(character.characterId),
							walletBalance: walletByCharacterId.get(character.characterId),
							isMetricsLoading: metricsLoadingByCharacterId.get(character.characterId),
							privateDataUnavailableNote: privateDataUnavailableNoteByCharacterId.get(
								character.characterId
							),
							joinDate: memberMetaByCharacterId.get(character.characterId)?.joinDate,
							lastLogin: memberMetaByCharacterId.get(character.characterId)?.lastLogin,
							locationSystem: memberMetaByCharacterId.get(character.characterId)?.locationSystem,
							locationRegion: memberMetaByCharacterId.get(character.characterId)?.locationRegion,
						}))}
						fulcrumLoading={fulcrumLoading && rows.length === 0}
						showViewDetailsButton
						isScanAllVisible
						isScanningAll={isScanningAll}
						scanAllLabel={
							isScanningAll ? 'Scanning All...' : `Scan All (${scanEligibleCharacters.length})`
						}
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
						getReportTarget={(character) => ({
							to: `/hr/users/${userId}/reports/${character.latestReport!.id}`,
							state: {
								characterName: character.characterName,
								userId: userId ?? undefined,
								returnTo: `${location.pathname}${location.search}`,
								backLabel: 'Back to User Profile',
								breadcrumbParentLabel: 'User Profile',
							},
						})}
						getDetailsTarget={(character) => ({
							to: `/character/${character.characterId}`,
							state: {
								source: 'hr-auditor-user-profile',
								backTo: `/hr/users/${userId}`,
								backLabel: 'Back to User Details',
								corporationId: character.corporationId ?? undefined,
							},
						})}
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
						getApplicationHref={(application) =>
							`/corporations/${application.corporationId}/applications/${application.id}`
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
			</>
		</UserProfilePageShell>
	)
}
