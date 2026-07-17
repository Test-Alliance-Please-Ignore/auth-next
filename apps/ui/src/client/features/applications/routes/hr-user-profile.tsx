import { useQuery, useQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'

import { LoadingSpinner } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { apiClient } from '@/lib/api'

import { useHrAccessibleCorporations } from '../../hr/hooks'
import {
	FulcrumBulkScanDialog,
	FulcrumSingleScanDialog,
	useFulcrumScanDmPreference,
} from '../components/fulcrum-scan-dialogs'
import {
	ProfileApplicationHistorySection,
	ProfileCharactersSection,
} from '../components/user-profile-sections'
import {
	UserProfilePageShell,
	UserProfileStatRow,
	UserProfileStatusBadge,
	UserProfileStatsSeparator,
} from '../components/user-profile-page-shell'
import { useRequestFulcrumReport, useRequestFulcrumReportBatch } from '../hooks'
import { getPrivateDataUnavailableMessage } from '../utils/private-data'
import {
	applicationsApi,
	type Application,
	type CharacterReportMetadata,
	type FulcrumCharacterData,
} from '../api'

interface ReviewerProfileNavigationState {
	source?: 'applications' | 'members'
	returnTo?: string
	corporationId?: string
}

interface ReviewerCharacterRow {
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

function isForbiddenError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403)
}

export default function HrUserProfilePage() {
	const { userId } = useParams<{ userId: string }>()
	const location = useLocation()
	const navigate = useNavigate()
	const { isAuthenticated, isLoading: authLoading } = useAuth()
	const [requestingCharacterId, setRequestingCharacterId] = useState<string | null>(null)
	const [isScanningAll, setIsScanningAll] = useState(false)
	const [scanAllDialogOpen, setScanAllDialogOpen] = useState(false)
	const [singleScanDialogCharacter, setSingleScanDialogCharacter] = useState<ReviewerCharacterRow | null>(null)
	const {
		sendDmForScanRequests,
		setSendDmForScanRequests,
		persistSendDmPreference,
	} = useFulcrumScanDmPreference()
	const { data: accessibleCorporations, isLoading: accessibleCorporationsLoading } =
		useHrAccessibleCorporations()

	const navigationState = location.state as ReviewerProfileNavigationState | null
	const source = navigationState?.source
	const returnTo = navigationState?.returnTo
	const fromApplications = source === 'applications' || returnTo?.includes('/applications')
	const fromMembers = source === 'members' || returnTo?.includes('/members')
	const backTarget = returnTo ?? '/hr/users'
	const breadcrumbMidLabel = fromApplications ? 'Applications' : fromMembers ? 'Members' : 'User Search'
	const backLabel = fromApplications ? 'Back to Applications' : fromMembers ? 'Back to Members' : 'Back to User Search'

	const applicationsQuery = useQuery<Application[]>({
		queryKey: ['hr', 'user-profile', userId, 'applications'],
		queryFn: () => applicationsApi.getApplications({ userId }),
		enabled: !!userId,
		retry: false,
		staleTime: 1000 * 60 * 2,
		gcTime: 1000 * 60 * 5,
		meta: {
			suppressErrorToast: true,
		},
	})

	const fulcrumQuery = useQuery<FulcrumCharacterData[]>({
		queryKey: ['hr', 'user-profile', userId, 'fulcrum'],
		queryFn: () => apiClient.get(`/fulcrum/users/${userId}/characters`),
		enabled: !!userId,
		retry: false,
		staleTime: 1000 * 30,
		gcTime: 1000 * 60 * 3,
		refetchInterval: (query) => {
			const data = query.state.data
			const hasInProgress = data?.some((ch) =>
				ch.reports.some((r) => r.status === 'pending' || r.status === 'processing')
			)
			return hasInProgress ? 10_000 : false
		},
		meta: {
			suppressErrorToast: true,
		},
	})

	const sortedApplications = useMemo(() => {
		if (!applicationsQuery.data) return []
		return [...applicationsQuery.data].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		)
	}, [applicationsQuery.data])

	const rows = useMemo<ReviewerCharacterRow[]>(() => {
		if (!fulcrumQuery.data) return []

		return fulcrumQuery.data
			.map((character, index) => {
				const latestReport = getLatestReport(character)
				const hasPendingReport =
					character.reports.some((report) => report.status === 'pending' || report.status === 'processing')
				const isPrimary = index === 0 || sortedApplications[0]?.characterId === character.characterId

				return {
					characterId: character.characterId,
					characterName: character.characterName,
					isPrimary,
					corporationId: character.corporationId ?? null,
					corporationName: character.corporationName ?? null,
					allianceId: character.allianceId ?? null,
					allianceName: character.allianceName ?? null,
					role: character.role ?? null,
					activityStatus: character.activityStatus ?? null,
					hasValidToken: character.hasValidToken ?? null,
					latestReport,
					hasPendingReport,
				}
			})
			.sort((a, b) => {
				if (a.isPrimary && !b.isPrimary) return -1
				if (!a.isPrimary && b.isPrimary) return 1
				return a.characterName.localeCompare(b.characterName)
			})
	}, [fulcrumQuery.data, sortedApplications])

	const characterDetailQueries = useQueries({
		queries: rows.map((character) => ({
			queryKey: ['character', character.characterId, 'hr-user-profile-private'],
			queryFn: () => apiClient.getCharacterPrivateDetail(character.characterId),
			enabled: !!character.characterId,
			retry: false,
			staleTime: 5 * 60 * 1000,
			meta: {
				suppressErrorToast: true,
			},
		})),
	})

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
			(query?.isPending ?? false) && detail == null
		)
		privateDataUnavailableNoteByCharacterId.set(
			character.characterId,
			getPrivateDataUnavailableMessage(query?.error)
		)
	})
	const privateDataUnavailableMessage =
		[...privateDataUnavailableNoteByCharacterId.values()].find((note) => Boolean(note)) ?? null

	const accountName =
		sortedApplications[0]?.characterName ?? rows.find((row) => row.isPrimary)?.characterName ?? rows[0]?.characterName ?? userId ?? 'Unknown'

	usePageTitle(accountName ? `${accountName} | HR User Details` : 'HR User Details')

	const canRequestFulcrumReports = (accessibleCorporations?.length ?? 0) > 0
	const canRequestCharacterReport = (character: { corporationId?: string | null }) =>
		Boolean(character.corporationId)
	const scanEligibleCharacters = rows.filter(
		(character) => !!character.corporationId && !character.hasPendingReport
	)

	const requestReport = useRequestFulcrumReport()
	const requestReportBatch = useRequestFulcrumReportBatch()
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if (!userId) {
		return <Navigate to="/hr/users" replace />
	}

	if (authLoading || accessibleCorporationsLoading) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<LoadingSpinner size="lg" />
			</div>
		)
	}

	if (isForbiddenError(fulcrumQuery.error) && !fulcrumQuery.data) {
		return (
			<UserProfilePageShell
				rootLabel="Users"
				rootTo="/hr/users"
				midLabel={breadcrumbMidLabel}
				backTarget={backTarget}
				backLabel={backLabel}
				accountName={accountName}
				userId={userId}
				mainCharacterId={undefined}
				mainCharacterName={undefined}
				sidebarBadges={
					<UserProfileStatusBadge variant="destructive">Access Denied</UserProfileStatusBadge>
				}
				sidebarStats={null}
			>
				<div className="max-w-2xl rounded-lg border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
					You do not have permission to view this user's HR profile.
				</div>
			</UserProfilePageShell>
		)
	}

	if (fulcrumQuery.isLoading && rows.length === 0) {
		return <div className="flex items-center justify-center min-h-[400px]"><LoadingSpinner size="lg" /></div>
	}

	const mainCharacter = rows.find((row) => row.isPrimary) ?? rows[0] ?? null
	const selectedCharacter = singleScanDialogCharacter

	const handleRequestReport = (character: ReviewerCharacterRow, sendDm: boolean) => {
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

	const handleScanAllCharacters = async (sendDm: boolean) => {
		if (!userId || scanEligibleCharacters.length === 0 || !canRequestFulcrumReports) return
		setIsScanningAll(true)
		try {
			const groups = new Map<string, string[]>()
			for (const character of scanEligibleCharacters) {
				const groupCorporationId = character.corporationId
				if (!groupCorporationId) continue
				const existing = groups.get(groupCorporationId)
				if (existing) {
					existing.push(character.characterId)
				} else {
					groups.set(groupCorporationId, [character.characterId])
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
			scanEligibleCharacters.length === 0 ||
			!canRequestFulcrumReports
		) {
			return
		}
		setScanAllDialogOpen(true)
	}

	const handleConfirmScanAll = () => {
		persistSendDmPreference(sendDmForScanRequests)
		setScanAllDialogOpen(false)
		void handleScanAllCharacters(sendDmForScanRequests)
	}

	const handleOpenSingleScanDialog = (character: ReviewerCharacterRow) => {
		if (!character.corporationId || isScanningAll || character.hasPendingReport) return
		setSingleScanDialogCharacter(character)
	}

	const handleConfirmSingleScan = () => {
		if (!selectedCharacter) return
		persistSendDmPreference(sendDmForScanRequests)
		const character = selectedCharacter
		setSingleScanDialogCharacter(null)
		handleRequestReport(character, sendDmForScanRequests)
	}

	return (
		<UserProfilePageShell
			rootLabel="Users"
			rootTo="/hr/users"
			midLabel={breadcrumbMidLabel}
			backTarget={backTarget}
			backLabel={backLabel}
			accountName={accountName}
			userId={userId}
			mainCharacterId={mainCharacter?.characterId}
			mainCharacterName={mainCharacter?.characterName}
			sidebarBadges={
				<UserProfileStatusBadge variant={canRequestFulcrumReports ? 'success' : 'secondary'}>
					{canRequestFulcrumReports ? 'HR Accessible' : 'HR Unavailable'}
				</UserProfileStatusBadge>
			}
			sidebarStats={
				<>
					<UserProfileStatRow label="Characters" value={rows.length} />
					<UserProfileStatsSeparator />
					<UserProfileStatRow label="Applications" value={sortedApplications.length} />
					<UserProfileStatsSeparator />
					<UserProfileStatRow
						label="Accessible corps"
						value={accessibleCorporations?.length ?? 0}
					/>
				</>
			}
		>
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
							latestReport: character.latestReport,
							hasPendingReport: character.hasPendingReport,
							skillPoints: spByCharacterId.get(character.characterId),
							walletBalance: walletByCharacterId.get(character.characterId),
							isMetricsLoading: metricsLoadingByCharacterId.get(character.characterId),
							privateDataUnavailableNote: privateDataUnavailableNoteByCharacterId.get(character.characterId),
						}))}
						fulcrumLoading={fulcrumQuery.isLoading && rows.length === 0}
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
						canRequestReports={canRequestFulcrumReports}
						canRequestCharacterReport={canRequestCharacterReport}
						onScanAll={handleOpenScanAllDialog}
						isScanPendingFor={(characterId) =>
							requestReport.isPending && requestingCharacterId === characterId
						}
						onViewReport={(character) => {
							const full = rows.find((row) => row.characterId === character.characterId)
							if (full?.latestReport?.status === 'completed') {
								navigate(`/hr/users/${userId}/reports/${full.latestReport.id}`, {
									state: {
										characterName: character.characterName,
										userId: userId ?? undefined,
										backTo: location.pathname + location.search,
										backLabel: 'Back to User Details',
										breadcrumbParentLabel: 'User Details',
									},
								})
							}
						}}
						onViewDetails={(character) => {
							const full = rows.find((row) => row.characterId === character.characterId)
							if (full) {
								navigate(`/character/${character.characterId}`, {
									state: {
										source: 'hr-member-profile',
										backTo: `/hr/users/${userId}`,
										backLabel: 'Back to User Details',
									},
								})
							}
						}}
						onScan={(character) => {
							const full = rows.find((row) => row.characterId === character.characterId)
							if (full) {
								handleOpenSingleScanDialog(full)
							}
						}}
					/>

					<ProfileApplicationHistorySection
						applications={sortedApplications.map((application) => ({
							id: application.id,
							corporationId: application.corporationId,
							corporationName: application.corporationName,
							characterId: application.characterId,
							characterName: application.characterName,
							status: application.status,
							createdAt: application.createdAt,
						}))}
						loading={applicationsQuery.isLoading}
						onOpenApplication={(application) =>
							navigate(`/corporations/${application.corporationId}/applications/${application.id}`)
						}
					/>

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
		</UserProfilePageShell>
	)
}
