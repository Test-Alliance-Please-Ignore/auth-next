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
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'

import { MemberAvatar } from '@/components/member-avatar'
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
	useApplicationFulcrum,
	useApplications,
	useHRNotes,
	useRequestFulcrumReport,
	useRequestFulcrumReportBatch,
} from '../hooks'

import type { CorporationMember } from '../../corporations/api'
import type { FulcrumCharacterData } from '../api'

// ============================================================================
// Types & Sub-Components
// ============================================================================

interface UnifiedCharacter {
	characterId: string
	characterName: string
	isInCorp: boolean
	member?: CorporationMember
	fulcrum?: FulcrumCharacterData
}


// Test compatibility helper retained after section-component extraction.
export function resolveEsiBadgeState({
	member,
	fulcrum,
	isInCorp,
}: {
	member?: CorporationMember
	fulcrum?: FulcrumCharacterData
	isInCorp: boolean
}): {
	show: boolean
	label: 'ESI Valid' | 'ESI Invalid' | 'ESI Unknown'
	variant: 'success' | 'destructive' | 'warning'
} {
	const tokenState = member?.hasValidToken ?? fulcrum?.hasValidToken ?? null
	const show = Boolean(member?.hasAuthAccount) || (!isInCorp && !!fulcrum)
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
	const [searchParams] = useSearchParams()
	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')
	const { canAccess: hasCorporationAccess } = useCanAccessCorporation(corporationId ?? '')
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

	// Fulcrum data – all HR viewers can access this, not just admins
	const { data: fulcrumCharacters, isLoading: fulcrumLoading } = useApplicationFulcrum(
		authUserId ?? '',
		corporationId ?? '',
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

	// Build a unified character list: in-corp members first, then external alts
	const unifiedCharacters = useMemo(() => {
		if (!account) return []
		const fulcrumByCharId = new Map(
			(fulcrumCharacters ?? []).map((fc) => [fc.characterId, fc]),
		)
		const corpCharIds = new Set(account.characters.map((c) => c.characterId))

		// In-corp characters, enriched with fulcrum data when available
		const inCorp: UnifiedCharacter[] = account.characters.map((m) => ({
			characterId: m.characterId,
			characterName: m.characterName,
			isInCorp: true,
			member: m,
			fulcrum: fulcrumByCharId.get(m.characterId),
		}))

		// External characters (on other corps) from fulcrum data
		const external: UnifiedCharacter[] = (fulcrumCharacters ?? [])
			.filter((fc) => !corpCharIds.has(fc.characterId))
			.map((fc) => ({
				characterId: fc.characterId,
				characterName: fc.characterName,
				isInCorp: fc.corporationId === corporationId,
				fulcrum: fc,
			}))

		return [...inCorp, ...external]
	}, [account, fulcrumCharacters])
	const characterDetailQueries = useQueries({
		queries: unifiedCharacters.map((character) => ({
			queryKey: ['character', character.characterId, 'hr-member-profile', corporationId],
			queryFn: () => apiClient.getCharacterDetail(character.characterId, corporationId),
			enabled: Boolean(corporationId),
			staleTime: 5 * 60 * 1000,
		})),
	})
	const spByCharacterId = new Map<string, number | null>()
	const walletByCharacterId = new Map<string, string | null>()
	const metricsLoadingByCharacterId = new Map<string, boolean>()
	unifiedCharacters.forEach((character, index) => {
		const query = characterDetailQueries[index]
		const detail = query?.data
		spByCharacterId.set(character.characterId, detail?.public?.skills?.totalSp ?? null)
		walletByCharacterId.set(character.characterId, detail?.private?.wallet?.balance ?? null)
		metricsLoadingByCharacterId.set(
			character.characterId,
			(query?.isPending ?? false) && detail == null
		)
	})

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
					character.fulcrum?.reports.some(
						(report) => report.status === 'pending' || report.status === 'processing'
					) ?? false
				return Boolean(character.fulcrum?.corporationId) && !hasPending
			}),
		[unifiedCharacters]
	)

	const handleScanAllCharacters = async (sendDm: boolean) => {
		if (!authUserId || scanEligibleCharacters.length === 0) return
		setIsScanningAll(true)
		try {
			const groups = new Map<string, string[]>()
			for (const character of scanEligibleCharacters) {
				const groupCorporationId = character.fulcrum?.corporationId
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
					targetUserId: authUserId,
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
			scanEligibleCharacters.length === 0
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

	const accountName = account?.mainName ?? searchParams.get('name') ?? 'Member'

	usePageTitle(accountName)

	// Navigation helpers
	const hasSupersedingCorpAccess = user?.is_admin || hasCorporationAccess
	const rootCorporationsPath = '/corporations'
	const rootCorporationsLabel = 'Corporations'

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if (!corporationId || !accountId) {
		return <Navigate to="/corporations" replace />
	}

	if (authLoading || permissionLoading || membersLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	if (!permission?.hasPermission && !user?.is_admin && !isAuditor) {
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
							You don't have HR permissions for this corporation.
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

	if (!hasSupersedingCorpAccess) {
		const queryReturnTo = searchParams.get('returnTo')
		const source =
			searchParams.get('from') === 'applications' ||
			searchParams.get('source') === 'applications' ||
			queryReturnTo?.includes('/applications')
				? 'applications'
				: 'members'
		const returnTo =
			queryReturnTo ??
			(source === 'applications' && corporationId
				? `/corporations/${corporationId}/applications`
				: '/hr/users')
		return (
			<Navigate
				to={`/hr/users/${accountId}`}
				replace
				state={{
					source,
					returnTo,
					corporationId,
				}}
			/>
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
							onClick={() => navigate(`/corporations/${corporationId}/members`)}
						>
							<ArrowLeft className="h-4 w-4" />
							Back to Members
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
							<BreadcrumbLink to={`/corporations/${corporationId}/members`}>
								Members
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
					onClick={() => navigate(`/corporations/${corporationId}/members`)}
				>
					<ArrowLeft className="h-4 w-4" />
					Back to Members
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
											Blacklisted
										</Badge>
									)}
								</div>
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
					<ProfileCharactersSection
						characters={unifiedCharacters.map((char) => ({
							characterId: char.characterId,
							characterName: char.characterName,
							hasValidToken: char.member?.hasValidToken ?? char.fulcrum?.hasValidToken ?? null,
							corporationId: char.member?.corporationId ?? char.fulcrum?.corporationId ?? null,
							corporationName: char.member?.corporationName ?? char.fulcrum?.corporationName ?? null,
							allianceId: char.member?.allianceId ?? char.fulcrum?.allianceId ?? null,
							allianceName: char.member?.allianceName ?? char.fulcrum?.allianceName ?? null,
							role: char.member?.role ?? char.fulcrum?.role ?? null,
							activityStatus: char.member?.activityStatus ?? char.fulcrum?.activityStatus ?? null,
							isExternal: !char.isInCorp,
							isBlacklisted: char.member?.isBlacklisted,
							lastLogin: char.member?.lastLogin,
							joinDate: char.member?.joinDate,
							skillPoints: spByCharacterId.get(char.characterId),
							walletBalance: walletByCharacterId.get(char.characterId),
							isMetricsLoading: metricsLoadingByCharacterId.get(char.characterId),
							latestReport: char.fulcrum?.reports[0] ?? null,
							hasPendingReport:
								char.fulcrum?.reports.some((r) => r.status === 'pending' || r.status === 'processing') ??
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
