/**
 * HR Member Profile Page
 *
 * Dedicated full-page view for an account's characters, HR notes,
 * Fulcrum reports, and application history. Two-column layout with
 * a sticky sidebar for identity/quick-actions and a scrollable
 * main content area.
 */

import {
	ArrowLeft,
	Link2,
	Loader2,
	ShieldAlert,
	Users,
	XCircle,
} from 'lucide-react'
import { useQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { formatDistanceToNow } from 'date-fns'

import { MemberAvatar } from '@/components/member-avatar'
import { CopyableMetaPill } from '@/components/copyable-meta-pill'
import { getEsiStatusBadgeState } from '@/components/esi-status-badge'
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

import { useHrPermissionCheck } from '../../hr/hooks'
import { useCanAccessCorporation, useCorporationMemberAccount } from '../../corporations/hooks'
import { AddHRNoteDialog } from '../components/add-hr-note-dialog'
import {
	ProfileApplicationHistorySection,
	ProfileCharactersSection,
	ProfileNotesSection,
} from '../components/user-profile-sections'
import {
	FulcrumBulkScanDialog,
	useFulcrumScanDmPreference,
} from '../components/fulcrum-scan-dialogs'
import {
	useApplications,
	useHRNotes,
	useRequestFulcrumReport,
	useRequestFulcrumReportBatch,
	useFulcrumUserReports,
	useHrUserCharacters,
} from '../hooks'
import type { CorporationMember } from '../../corporations/api'
import type { FulcrumCharacterReportData } from '../api'
import { getPrivateDataUnavailableMessage } from '../utils/private-data'

// ============================================================================
// Types & Sub-Components
// ============================================================================

interface UnifiedCharacter {
	characterId: string
	characterName: string
	isInCorp: boolean
	role?: 'CEO' | 'Director' | 'Member' | null
	member?: CorporationMember
	hr?: {
		characterId: string
		characterName: string
		hasValidToken: boolean
		corporationId?: string | null
		corporationName?: string | null
		allianceId?: string | null
		allianceName?: string | null
	}
	report?: FulcrumCharacterReportData
}


// Test compatibility helper retained after section-component extraction.
export function resolveEsiBadgeState({
	member,
	hr,
	isInCorp,
}: {
	member?: CorporationMember
	hr?: {
		hasValidToken?: boolean | null
	}
	isInCorp: boolean
}): {
	show: boolean
	label: 'ESI Valid' | 'ESI Invalid' | 'ESI Unknown'
	variant: 'success' | 'destructive' | 'warning'
} {
	const tokenState = member?.hasValidToken ?? hr?.hasValidToken ?? null
	const show = Boolean(member?.hasAuthAccount) || (!!hr && !isInCorp)
	const shared = getEsiStatusBadgeState({
		hasAuthAccount: show,
		hasValidToken: tokenState,
	})
	return {
		show,
		label: shared.label === 'Unlinked' ? 'ESI Unknown' : shared.label,
		variant: shared.variant,
	}
}


// ============================================================================
// Main Component
// ============================================================================

export default function HrMemberProfile() {
	const { corporationId, accountId } = useParams<{ corporationId: string; accountId: string }>()
	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')
	const {
		canAccess: hasCorporationAccess,
		isLoading: corporationAccessLoading,
	} = useCanAccessCorporation(corporationId ?? '')
	const [addNoteOpen, setAddNoteOpen] = useState(false)
	const [scanAllDialogOpen, setScanAllDialogOpen] = useState(false)
	const [isScanningAll, setIsScanningAll] = useState(false)
	const {
		sendDmForScanRequests,
		setSendDmForScanRequests,
		persistSendDmPreference,
	} = useFulcrumScanDmPreference()

	// Permissions
	const { data: permission, isLoading: permissionLoading } = useHrPermissionCheck(
		corporationId ? { corporationId } : null,
	)

	// Fetch specific linked member account details (non-paginated endpoint)
	const { data: memberAccountResponse, isLoading: membersLoading } = useCorporationMemberAccount(
		corporationId ?? '',
		accountId ?? ''
	)
	const account = memberAccountResponse?.account ?? null

	const representative = account?.representative
	const authUserId = representative?.authUserId

	const isAdmin = useMemo(() => {
		if (user?.is_admin) return true
		return permission?.currentRole === 'hr_admin'
	}, [user, permission])

	const canAddNote = isAdmin && !isAuditor

	// HR notes — admins and auditors can view
	const { data: notes, isLoading: notesLoading } = useHRNotes(
		(isAdmin || isAuditor) && authUserId ? { subjectUserId: authUserId } : undefined,
	)

	const { data: hrCharacters = [] } = useHrUserCharacters(authUserId ?? '', {
		enabled: account?.isLinked && !!authUserId,
	})
	const { data: reportCharacters = [], isLoading: fulcrumLoading } = useFulcrumUserReports(
		authUserId ?? '',
		account?.isLinked && !!authUserId,
	)

	const requestReport = useRequestFulcrumReport()
	const requestReportBatch = useRequestFulcrumReportBatch()

	// Application history
	const { data: applications, isLoading: appsLoading } = useApplications(
		account?.isLinked ? { corporationId, userId: authUserId } : undefined,
	)

	const sortedApps = useMemo(() => {
		if (!applications) return []
		return [...applications].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		)
	}, [applications])
	const reportCharacterById = useMemo(
		() => new Map((reportCharacters ?? []).map((character) => [character.characterId, character])),
		[reportCharacters]
	)
	const hrCharacterById = useMemo(
		() => new Map(hrCharacters.map((character) => [character.characterId, character])),
		[hrCharacters]
	)
	// Build a unified character list: in-corp members first, then external alts
	const unifiedCharacters = useMemo(() => {
		if (!account) return []
		const corpCharIds = new Set(account.characters.map((c) => c.characterId))

		// In-corp characters, enriched with HR/report data when available
		const inCorp: UnifiedCharacter[] = account.characters.map((m) => ({
			characterId: m.characterId,
			characterName: m.characterName,
			isInCorp: true,
			member: m,
			hr: hrCharacterById.get(m.characterId),
			report: reportCharacterById.get(m.characterId),
		}))

		// External characters come from HR-linked characters, with report metadata joined in.
		const external: UnifiedCharacter[] = hrCharacters
			.filter((character) => !corpCharIds.has(character.characterId))
			.map((character) => ({
				characterId: character.characterId,
				characterName: character.characterName,
				isInCorp: false,
				hr: character,
				report: reportCharacterById.get(character.characterId),
			}))

		return [...inCorp, ...external]
	}, [account, hrCharacters, hrCharacterById, reportCharacterById])
	const characterDetailQueries = useQueries({
		queries: unifiedCharacters.map((character) => ({
			queryKey: ['character', character.characterId, 'hr-member-profile-private'],
			queryFn: () => apiClient.getCharacterPrivateDetail(character.characterId),
			meta: {
				suppressErrorToast: true,
			},
			enabled: Boolean(character.characterId),
			staleTime: 5 * 60 * 1000,
		})),
	})
	const spByCharacterId = new Map<string, number | null>()
	const walletByCharacterId = new Map<string, string | null>()
	const metricsLoadingByCharacterId = new Map<string, boolean>()
	const privateDataUnavailableNoteByCharacterId = new Map<string, string | null>()
	unifiedCharacters.forEach((character, index) => {
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

	const totalCharacters = unifiedCharacters.length
	const inCorpCharacterCount = useMemo(() => {
		const inCorpIds = new Set(
			unifiedCharacters
				.filter((character) => character.isInCorp)
				.map((character) => character.characterId)
		)
		return inCorpIds.size
	}, [unifiedCharacters])
	const scanEligibleCharacters = useMemo(
		() =>
			unifiedCharacters.filter((character) => {
				const hasPending =
					character.report?.reports.some(
						(report) => report.status === 'pending' || report.status === 'processing'
					) ?? false
				return (
					Boolean(character.member?.corporationId ?? character.hr?.corporationId) &&
					!hasPending &&
					((user?.is_admin || isAuditor) || character.role !== 'CEO')
				)
			}),
		[isAuditor, unifiedCharacters, user?.is_admin]
	)
	const canRequestFulcrumReports = useMemo(() => {
		if (user?.is_admin || isAuditor) return true
		return permission?.currentRole === 'hr_admin' || permission?.currentRole === 'hr_reviewer'
	}, [isAuditor, permission?.currentRole, user?.is_admin])
	const canRequestCeoReports = user?.is_admin || isAuditor
	const canRequestCharacterReport = (character: { role?: 'CEO' | 'Director' | 'Member' | null }) =>
		canRequestFulcrumReports && (canRequestCeoReports || character.role !== 'CEO')

	const handleScanAllCharacters = async (sendDm: boolean) => {
		if (!authUserId || scanEligibleCharacters.length === 0 || !canRequestFulcrumReports) return
		setIsScanningAll(true)
		try {
			const groups = new Map<string, string[]>()
			for (const character of scanEligibleCharacters) {
				const groupCorporationId = character.member?.corporationId ?? character.hr?.corporationId
				if (!groupCorporationId) continue
				const existing = groups.get(groupCorporationId)
				if (existing) {
					existing.push(character.characterId)
				} else {
					groups.set(groupCorporationId, [character.characterId])
				}
			}
			let sentDmForAnyBatch = false
			for (const [groupCorporationId, characterIds] of groups.entries()) {
				const sendDmForBatch = sendDm && !sentDmForAnyBatch
				await requestReportBatch.mutateAsync({
					characterIds,
					corporationId: groupCorporationId,
					requestSource: 'hr',
					userId: authUserId,
					sendDm: sendDmForBatch,
				})
				if (sendDmForBatch) sentDmForAnyBatch = true
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

	const accountName = account?.mainName ?? 'Member'

	usePageTitle(accountName)

	// Navigation helpers
	const canViewCorpMemberPage = user?.is_admin || hasCorporationAccess || isAuditor
	const backPath = `/corporations/${corporationId}/members`
	const backLabel = 'Back to Members'
	const breadcrumbParentLabel = 'Members'
	const rootCorporationsPath = '/corporations'
	const rootCorporationsLabel = 'Corporations'
	const isCorporationAccessPending = !isAuditor && corporationAccessLoading

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if (!corporationId || !accountId) {
		return <Navigate to="/corporations" replace />
	}

	if (authLoading || permissionLoading || membersLoading || isCorporationAccessPending) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	if (!canViewCorpMemberPage) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							Access Denied
						</CardTitle>
					</CardHeader>
					<CardContent className="text-center">
						<p className="text-red-700 dark:text-red-300 mb-4">
							You don't have permission to view members of this corporation.
						</p>
						<Button variant="ghost" onClick={() => navigate(rootCorporationsPath)}>
							<ArrowLeft className="h-4 w-4" />
							Back to {rootCorporationsLabel}
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	if (!account || !representative) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto">
					<CardHeader className="text-center">
						<CardTitle>Member Not Found</CardTitle>
					</CardHeader>
					<CardContent className="text-center">
						<p className="text-muted-foreground mb-4">
							This account could not be found in the corporation member list.
						</p>
						<Button
							variant="ghost"
							onClick={() => navigate(backPath)}
						>
							<ArrowLeft className="h-4 w-4" />
							{backLabel}
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			{/* Breadcrumbs + Back */}
			<div className="flex items-center justify-between mb-6">
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink to={rootCorporationsPath}>
								{rootCorporationsLabel}
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink to={backPath}>
								{breadcrumbParentLabel}
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{accountName}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
				<Button
					variant="ghost"
					onClick={() => navigate(backPath)}
				>
					<ArrowLeft className="h-4 w-4" />
					{backLabel}
				</Button>
			</div>

			{/* Two-column layout */}
			<div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
				{/* ── Sidebar ── */}
				<div className="space-y-4 lg:sticky lg:top-8 lg:self-start">
					{/* Identity Card */}
					<Card>
						<CardContent className="pt-6">
							<div className="flex flex-col items-center text-center space-y-3">
								<MemberAvatar
									characterId={representative.characterId}
									characterName={accountName}
									size="lg"
								/>
								<div className="space-y-1">
									<h1 className="text-xl font-bold">{accountName}</h1>
									<p className="text-sm text-muted-foreground">
										{representative.corporationName}
									</p>
									{representative.allianceName && (
										<p className="text-xs text-muted-foreground">
											{representative.allianceName}
										</p>
									)}
								</div>
								<div className="flex items-center gap-2">
									{account.isLinked ? (
										<Badge variant="success" className="gap-1">
											<Link2 className="h-3 w-3" />
											Registered
										</Badge>
									) : (
										<Badge variant="destructive" className="gap-1">
											<XCircle className="h-3 w-3" />
											Not Registered
										</Badge>
									)}
									{account.hasBlacklisted && (
										<Badge variant="destructive" className="gap-1">
											<ShieldAlert className="h-3 w-3" />
											Blocklisted
										</Badge>
									)}
								</div>
								{(representative.discordUsername || representative.discordUserId) && (
									<div className="flex flex-wrap items-center justify-center gap-2">
										{representative.discordUsername ? (
											<CopyableMetaPill
												label="Discord username"
												value={representative.discordUsername}
											/>
										) : null}
										{representative.discordUserId ? (
											<CopyableMetaPill
												label="Discord ID"
												value={representative.discordUserId}
											/>
										) : null}
									</div>
								)}
							</div>
						</CardContent>
					</Card>

					{/* Quick Stats */}
					<Card>
						<CardContent className="pt-6 space-y-3">
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">Highest Role</span>
								<Badge
									variant={
										account.highestRole === 'CEO'
											? 'destructive'
											: account.highestRole === 'Director'
												? 'warning'
												: 'default'
									}
									className="text-[10px]"
								>
									{account.highestRole}
								</Badge>
							</div>
							<Separator />
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">Characters</span>
								<span className="font-medium">
									{inCorpCharacterCount} in corp
									{totalCharacters > inCorpCharacterCount && (
										<span className="text-muted-foreground font-normal">
											{' '}/ {totalCharacters} total
										</span>
									)}
								</span>
							</div>
							<Separator />
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">Joined</span>
								<span className="font-medium">
									{formatDistanceToNow(new Date(representative.joinDate), {
										addSuffix: true,
									})}
								</span>
							</div>
							{representative.lastLogin && (
								<>
									<Separator />
									<div className="flex justify-between text-sm">
										<span className="text-muted-foreground">Last Login</span>
										<span className="font-medium">
											{formatDistanceToNow(new Date(representative.lastLogin), {
												addSuffix: true,
											})}
										</span>
									</div>
								</>
							)}
						</CardContent>
					</Card>

				</div>

				{/* ── Main Content ── */}
				<div className="space-y-6">
					{privateDataUnavailableMessage && (
						<div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
							<div className="flex items-start gap-3">
								<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
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
						characters={unifiedCharacters.map((char) => ({
							characterId: char.characterId,
							characterName: char.characterName,
							hasValidToken: char.member?.hasValidToken ?? char.hr?.hasValidToken ?? null,
							corporationId: char.member?.corporationId ?? char.hr?.corporationId ?? null,
							corporationName: char.member?.corporationName ?? char.hr?.corporationName ?? null,
							allianceId: char.member?.allianceId ?? char.hr?.allianceId ?? null,
							allianceName: char.member?.allianceName ?? char.hr?.allianceName ?? null,
							role: char.member?.role ?? char.report?.role ?? null,
							activityStatus: char.member?.activityStatus ?? char.report?.activityStatus ?? null,
							isExternal: !char.isInCorp,
							isBlacklisted: char.member?.isBlacklisted,
							lastLogin: char.member?.lastLogin,
							joinDate: char.member?.joinDate,
							skillPoints: spByCharacterId.get(char.characterId),
							walletBalance: walletByCharacterId.get(char.characterId),
							isMetricsLoading: metricsLoadingByCharacterId.get(char.characterId),
							latestReport: char.report?.reports[0] ?? null,
							hasPendingReport:
								char.report?.reports.some((r) => r.status === 'pending' || r.status === 'processing') ??
								false,
						}))}
						fulcrumLoading={
							fulcrumLoading && unifiedCharacters.length === account.characters.length
						}
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
							canRequestReports={canRequestFulcrumReports}
							canRequestCharacterReport={canRequestCharacterReport}
							onScanAll={handleOpenScanAllDialog}
						isScanPendingFor={(characterId) =>
							requestReport.isPending &&
							(requestReport.variables as { characterId?: string } | undefined)?.characterId ===
								characterId
						}
						onViewReport={(character) => {
							if (character.latestReport?.status !== 'completed') return
							navigate(`/fulcrum/reports/${character.latestReport.id}`, {
								state: {
									characterName: character.characterName,
									userId: accountId,
									corporationId,
									returnTo: `/corporations/${corporationId}/members/${accountId}`,
									backLabel: 'Back to User Profile',
									breadcrumbParentLabel: 'User Profile',
								},
							})
						}}
						onScan={(character) => {
							if (!character.corporationId || !authUserId) return
							requestReport.mutate({
								characterId: character.characterId,
								corporationId: character.corporationId,
								requestSource: 'hr',
								userId: authUserId,
							})
						}}
					/>

					{(isAdmin || isAuditor) && authUserId && (
						<ProfileNotesSection
							notes={notes}
							loading={notesLoading}
							canAddNote={canAddNote}
							onAddNote={() => setAddNoteOpen(true)}
							emptyText="No HR notes for this account"
						/>
					)}

					<ProfileApplicationHistorySection
						applications={sortedApps.map((app) => ({
							id: app.id,
							corporationId: app.corporationId,
							corporationName: app.corporationName,
							characterId: app.characterId,
							characterName: app.characterName,
							status: app.status,
							createdAt: app.createdAt,
						}))}
						loading={appsLoading}
						linked={account.isLinked}
						emptyText="No applications found"
						onOpenApplication={(application) =>
							navigate(`/corporations/${corporationId}/applications/${application.id}`)
						}
					/>
				</div>
			</div>

			{/* Add HR Note Dialog */}
			{canAddNote && authUserId && (
				<AddHRNoteDialog
					open={addNoteOpen}
					onOpenChange={setAddNoteOpen}
					subjectUserId={authUserId}
					subjectCharacterId={representative.characterId}
					subjectCharacterName={accountName}
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
		</Container>
	)
}
