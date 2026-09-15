import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'

import { LoadingSpinner } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'

import { useHrAccessibleCorporations } from '../../hr/hooks'
import { applicationsApi } from '../api'
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
	applicationKeys,
	useCharacterPrivateDetailsBulk,
	useFulcrumUserReports,
	useHRNotes,
	useHrUserBlocklistStatus,
	useHrUserCharacters,
	useHrUserMumbleStatus,
	useRequestFulcrumReport,
	useRequestFulcrumReportBatch,
} from '../hooks'
import { getPrivateDataUnavailableMessage } from '../utils/private-data'
import { getApplicationProfileNavigationFromReferrer } from '../utils/profile-navigation'

import type { Application, CharacterReportMetadata, FulcrumCharacterReportData } from '../api'

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
	isBlacklisted: boolean | null | undefined
	latestReport: CharacterReportMetadata | null
	hasPendingReport: boolean
}

function getLatestReport(character: FulcrumCharacterReportData): CharacterReportMetadata | null {
	if (character.reports.length === 0) return null
	return character.reports.reduce((latest, report) =>
		new Date(report.createdAt) > new Date(latest.createdAt) ? report : latest
	)
}

function isForbiddenError(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === 'object' &&
			'status' in error &&
			(error as { status?: number }).status === 403
	)
}

export default function HrUserProfilePage() {
	const { userId } = useParams<{ userId: string }>()
	const location = useLocation()
	const queryClient = useQueryClient()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { t } = useAppTranslation()
	const [requestingCharacterId, setRequestingCharacterId] = useState<string | null>(null)
	const [isScanningAll, setIsScanningAll] = useState(false)
	const [scanAllDialogOpen, setScanAllDialogOpen] = useState(false)
	const [singleScanDialogCharacter, setSingleScanDialogCharacter] =
		useState<ReviewerCharacterRow | null>(null)
	const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false)
	const { sendDmForScanRequests, setSendDmForScanRequests, persistSendDmPreference } =
		useFulcrumScanDmPreference()
	const { data: accessibleCorporations, isLoading: accessibleCorporationsLoading } =
		useHrAccessibleCorporations()
	const { data: mumbleStatus } = useHrUserMumbleStatus(userId ?? '', {
		enabled: !!userId,
	})

	const [referrerNavigationState] = useState(getApplicationProfileNavigationFromReferrer)
	const navigationState =
		(location.state as ReviewerProfileNavigationState | null) ?? referrerNavigationState
	const source = navigationState?.source
	const returnTo = navigationState?.returnTo
	const fromApplications = source === 'applications' || returnTo?.includes('/applications')
	const fromMembers = source === 'members' || returnTo?.includes('/members')
	const backTarget = returnTo ?? '/hr/users'
	const breadcrumbMidLabel = fromApplications
		? t('hr.profile.applications')
		: fromMembers
			? t('hr.profile.members')
			: t('hr.profile.userSearch')
	const backLabel = fromApplications
		? t('hr.profile.backToApplications')
		: fromMembers
			? t('hr.profile.backToMembers')
			: t('hr.profile.backToUserSearch')

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

	const characterQuery = useHrUserCharacters(userId ?? '', {
		enabled: !!userId,
	})
	const { data: userBlocklistStatus } = useHrUserBlocklistStatus(userId ?? '', {
		enabled: !!userId,
	})
	const {
		data: notes = [],
		isLoading: notesLoading,
		error: notesError,
	} = useHRNotes(userId ? { subjectUserId: userId } : undefined, { enabled: !!userId })
	const canViewNotes = !!userId && !notesLoading && !notesError

	const {
		data: reportCharacters = [],
		isLoading: reportLoading,
		isSuccess: reportLoaded,
		error: reportError,
	} = useFulcrumUserReports(userId ?? '', { enabled: !!userId })
	const reportCharacterById = useMemo(
		() => new Map(reportCharacters.map((character) => [character.characterId, character])),
		[reportCharacters]
	)
	const reportAccessDenied = isForbiddenError(reportError)
	const fulcrumAccessDeniedMessage = reportAccessDenied ? t('hr.fulcrum.hiddenDescription') : null
	const fulcrumUnavailableMessage =
		reportError && !reportAccessDenied ? t('hr.profile.fulcrumUnavailable') : null
	const canViewFulcrumReports = reportLoaded
	const canRequestFulcrumReports =
		canViewFulcrumReports && (accessibleCorporations?.length ?? 0) > 0

	const sortedApplications = useMemo(() => {
		if (!applicationsQuery.data) return []
		return [...applicationsQuery.data].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		)
	}, [applicationsQuery.data])

	const rows = useMemo<ReviewerCharacterRow[]>(() => {
		if (!characterQuery.data) return []

		return characterQuery.data
			.map((character) => {
				const report = reportCharacterById.get(character.characterId)
				const latestReport = report ? getLatestReport(report) : null
				const hasPendingReport =
					report?.reports.some(
						(entry) => entry.status === 'pending' || entry.status === 'processing'
					) ?? false
				const isPrimary = character.is_primary

				return {
					characterId: character.characterId,
					characterName: character.characterName,
					isPrimary,
					corporationId: character.corporationId ?? null,
					corporationName: character.corporationName ?? null,
					allianceId: character.allianceId ?? null,
					allianceName: character.allianceName ?? null,
					role: report?.role ?? null,
					activityStatus: report?.activityStatus ?? null,
					hasValidToken: character.hasValidToken,
					isBlacklisted: character.isBlacklisted,
					latestReport,
					hasPendingReport,
				}
			})
			.sort((a, b) => {
				if (a.isPrimary && !b.isPrimary) return -1
				if (!a.isPrimary && b.isPrimary) return 1
				return a.characterName.localeCompare(b.characterName)
			})
	}, [characterQuery.data, reportCharacterById])

	const characterDetailQuery = useCharacterPrivateDetailsBulk(
		rows.map((character) => character.characterId)
	)
	const characterDetailById = new Map(
		(characterDetailQuery.data?.items ?? []).map((item) => [item.characterId, item])
	)

	const spByCharacterId = new Map<string, number | null>()
	const walletByCharacterId = new Map<string, string | null>()
	const metricsLoadingByCharacterId = new Map<string, boolean>()
	const privateDataUnavailableNoteByCharacterId = new Map<string, string | null>()
	rows.forEach((character) => {
		const item = characterDetailById.get(character.characterId)
		const detail = item?.data
		spByCharacterId.set(character.characterId, detail?.skills?.totalSp ?? null)
		walletByCharacterId.set(character.characterId, detail?.private?.wallet?.balance ?? null)
		metricsLoadingByCharacterId.set(
			character.characterId,
			characterDetailQuery.isFetching && detail == null
		)
		privateDataUnavailableNoteByCharacterId.set(
			character.characterId,
			getPrivateDataUnavailableMessage(
				item?.status === 'forbidden'
					? { status: 403 }
					: item?.status === 'unavailable'
						? { status: 500 }
						: null
			)
		)
	})
	const privateDataUnavailableMessage =
		[...privateDataUnavailableNoteByCharacterId.values()].find((note) => Boolean(note)) ?? null

	const accountName =
		rows.find((row) => row.isPrimary)?.characterName ??
		sortedApplications[0]?.characterName ??
		rows[0]?.characterName ??
		userId ??
		'Unknown'

	usePageTitle(
		accountName
			? t('hr.profile.pageTitle', { name: accountName })
			: t('hr.profile.pageTitleFallback')
	)

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

	if (isForbiddenError(characterQuery.error) && !characterQuery.data) {
		return (
			<UserProfilePageShell
				rootLabel={t('hr.profile.users')}
				rootTo="/hr/users"
				midLabel={breadcrumbMidLabel}
				backTarget={backTarget}
				backLabel={backLabel}
				accountName={accountName}
				userId={userId}
				mainCharacterId={undefined}
				mainCharacterName={undefined}
				sidebarBadges={
					<UserProfileStatusBadge variant="destructive">
						{t('hr.profile.accessDenied')}
					</UserProfileStatusBadge>
				}
				sidebarStats={null}
			>
				<div className="max-w-2xl rounded-lg border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
					{t('hr.profile.accessDeniedDescription')}
				</div>
			</UserProfilePageShell>
		)
	}

	if (characterQuery.isLoading && rows.length === 0) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<LoadingSpinner size="lg" />
			</div>
		)
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
			rootLabel={t('hr.profile.users')}
			rootTo="/hr/users"
			midLabel={breadcrumbMidLabel}
			backTarget={backTarget}
			backLabel={backLabel}
			accountName={accountName}
			userId={userId}
			mainCharacterId={mainCharacter?.characterId}
			mainCharacterName={mainCharacter?.characterName}
			isMainCharacterBlacklisted={Boolean(mainCharacter?.isBlacklisted)}
			isAccountBlacklisted={Boolean(userBlocklistStatus?.isBlacklisted)}
			sidebarBadges={
				<>
					{userBlocklistStatus?.isBlacklisted && (
						<UserProfileStatusBadge variant="destructive">
							{t('hr.profile.blocklisted')}
						</UserProfileStatusBadge>
					)}
					{userBlocklistStatus?.discordAccountLinked === true && (
						<UserProfileStatusBadge variant="success">
							{t('hr.search.discordLinked')}
						</UserProfileStatusBadge>
					)}
					{userBlocklistStatus?.discordAccountLinked === false && (
						<UserProfileStatusBadge variant="destructive">
							{t('hr.search.discordNotLinked')}
						</UserProfileStatusBadge>
					)}
					{mumbleStatus?.mumbleAccountLinked === true && (
						<UserProfileStatusBadge variant="success">
							{t('hr.mumble.linked')}
						</UserProfileStatusBadge>
					)}
					{mumbleStatus?.mumbleAccountLinked === false && (
						<UserProfileStatusBadge variant="destructive">
							{t('hr.mumble.notLinked')}
						</UserProfileStatusBadge>
					)}
				</>
			}
			sidebarStats={
				<>
					<UserProfileStatRow label={t('hr.profile.characters')} value={rows.length} />
					<UserProfileStatsSeparator />
					<UserProfileStatRow
						label={t('hr.profile.applications')}
						value={sortedApplications.length}
					/>
					<UserProfileStatsSeparator />
					<UserProfileStatRow
						label={t('hr.profile.accessibleCorps')}
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
							<p className="font-medium">{t('hr.profile.privateEsiHidden')}</p>
							<p className="text-sm text-amber-800 dark:text-amber-200">
								{privateDataUnavailableMessage}
							</p>
						</div>
					</div>
				</div>
			)}
			{fulcrumAccessDeniedMessage && (
				<div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
					<div className="flex items-start gap-3">
						<AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
						<div className="space-y-1">
							<p className="font-medium">{t('hr.fulcrum.hiddenTitle')}</p>
							<p className="text-sm text-amber-800 dark:text-amber-200">
								{fulcrumAccessDeniedMessage}
							</p>
						</div>
					</div>
				</div>
			)}
			{fulcrumUnavailableMessage && (
				<div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
					<div className="flex items-start gap-3">
						<AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
						<div className="space-y-1">
							<p className="font-medium">{t('hr.profile.fulcrumUnavailable')}</p>
							<p className="text-sm text-sky-800 dark:text-sky-200">{fulcrumUnavailableMessage}</p>
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
				}))}
				fulcrumLoading={canViewFulcrumReports && reportLoading && rows.length === 0}
				showFulcrumReports={canViewFulcrumReports}
				showViewDetailsButton
				isScanAllVisible
				isScanningAll={isScanningAll}
				scanAllLabel={
					isScanningAll
						? t('hr.profile.scanningAll')
						: t('hr.profile.scanAll', { count: scanEligibleCharacters.length })
				}
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
				getReportTarget={(character) => ({
					to: `/hr/users/${userId}/reports/${character.latestReport!.id}`,
				})}
				getDetailsTarget={(character) => ({
					to: `/character/${character.characterId}`,
					state: {
						source: 'hr-member-profile',
						backTo: `/hr/users/${userId}`,
						backLabel: t('hr.profile.backToUserDetails'),
					},
				})}
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
				getApplicationHref={(application) =>
					`/corporations/${application.corporationId}/applications/${application.id}`
				}
			/>

			{canViewNotes && (
				<ProfileNotesSection
					notes={notes}
					loading={notesLoading}
					canAddNote
					onAddNote={() => setAddNoteDialogOpen(true)}
					emptyText={t('hr.profile.noNotes')}
				/>
			)}

			{canViewFulcrumReports && (
				<>
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
						characterName={
							singleScanDialogCharacter?.characterName ?? t('hr.profile.characterFallback')
						}
						sendDmForScanRequests={sendDmForScanRequests}
						setSendDmForScanRequests={setSendDmForScanRequests}
						onConfirm={handleConfirmSingleScan}
					/>
				</>
			)}
			{canViewNotes && userId && (
				<AddHRNoteDialog
					open={addNoteDialogOpen}
					onOpenChange={setAddNoteDialogOpen}
					subjectUserId={userId}
					subjectCharacterId={rows[0]?.characterId}
					subjectCharacterName={rows[0]?.characterName}
					canSelectVisibility={user?.is_admin === true}
					canSelectAdminVisibility={user?.is_admin === true}
					initialVisibility="admin"
					onSuccess={() => {
						void queryClient.invalidateQueries({ queryKey: applicationKeys.hrNotes() })
					}}
				/>
			)}
		</UserProfilePageShell>
	)
}
