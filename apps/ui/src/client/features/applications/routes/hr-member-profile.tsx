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
	Calendar,
	Clock,
	ExternalLink,
	FileText,
	Link2,
	Loader2,
	MapPin,
	MessageSquarePlus,
	Scan,
	ShieldAlert,
	User,
	Users,
	XCircle,
} from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { useHrPermissionCheck } from '../../hr/hooks'
import { useCanAccessCorporation, useCorporationMembers } from '../../corporations/hooks'
import { AddHRNoteDialog } from '../components/add-hr-note-dialog'
import { ApplicationStatusBadge } from '../components/application-status-badge'
import { useApplicationFulcrum, useApplications, useHRNotes, useRequestFulcrumReport } from '../hooks'
import { groupByAccount } from '../components/hr-members-table'

import type { CorporationMember } from '../../corporations/api'
import type { CharacterReportMetadata, FulcrumCharacterData, HRNote } from '../api'

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

function CharacterCard({
	character,
	corporationId,
	userId,
	isAdmin,
	onRequestReport,
	onViewReport,
}: {
	character: UnifiedCharacter
	corporationId: string
	userId: string | undefined
	isAdmin: boolean
	onRequestReport: ReturnType<typeof useRequestFulcrumReport>
	onViewReport: (reportId: string, characterName: string) => void
}) {
	const { member, fulcrum, isInCorp } = character
	const latestReport = fulcrum?.reports[0] as CharacterReportMetadata | undefined
	const isRequesting =
		onRequestReport.isPending &&
		(onRequestReport.variables as { characterId?: string })?.characterId === character.characterId
	const hasPending = fulcrum?.reports.some(
		(r) => r.status === 'pending' || r.status === 'processing',
	)
	const esiBadge = resolveEsiBadgeState({ member, fulcrum, isInCorp })

	return (
		<div className={cn('rounded-lg border p-3 space-y-2', !isInCorp && 'border-dashed opacity-80')}>
			<div className="flex items-start gap-3">
				<MemberAvatar
					characterId={character.characterId}
					characterName={character.characterName}
					size="md"
				/>
				<div className="min-w-0 flex-1 space-y-1">
					<div className="flex items-center gap-2">
						<p className="font-medium truncate">{character.characterName}</p>
						{isInCorp && member ? (
							<Badge
								variant={
									member.role === 'CEO'
										? 'destructive'
										: member.role === 'Director'
											? 'warning'
											: 'default'
								}
								className="text-[10px] px-1.5 py-0 shrink-0"
							>
								{member.role}
							</Badge>
						) : (
							<Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
								External
							</Badge>
						)}
					</div>
					{isInCorp && member ? (
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
							{esiBadge.show && (
								<Badge variant={esiBadge.variant} className="text-[10px] px-1.5 py-0">
									{esiBadge.label}
								</Badge>
							)}
							<Badge
								variant={
									member.activityStatus === 'active'
										? 'success'
										: member.activityStatus === 'inactive'
											? 'destructive'
											: 'secondary'
								}
								className="text-[10px] px-1.5 py-0"
							>
								{member.activityStatus}
							</Badge>
							{member.lastLogin && (
								<span className="flex items-center gap-1">
									<Clock className="h-3 w-3" />
									{formatDistanceToNow(new Date(member.lastLogin), { addSuffix: true })}
								</span>
							)}
							<span className="flex items-center gap-1">
								<Calendar className="h-3 w-3" />
								Joined {formatDistanceToNow(new Date(member.joinDate), { addSuffix: true })}
							</span>
							{member.locationSystem && (
								<span className="flex items-center gap-1">
									<MapPin className="h-3 w-3" />
									{member.locationSystem}
									{member.locationRegion && ` (${member.locationRegion})`}
								</span>
							)}
						</div>
					) : (
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
							{esiBadge.show && (
								<Badge variant={esiBadge.variant} className="text-[10px] px-1.5 py-0">
									{esiBadge.label}
								</Badge>
							)}
							{fulcrum?.corporationName && <span>{fulcrum.corporationName}</span>}
						</div>
					)}
				</div>
				{member?.isBlacklisted && (
					<Badge variant="destructive" className="shrink-0 gap-1">
						<ShieldAlert className="h-3 w-3" />
						Blacklisted
					</Badge>
				)}
			</div>

			{/* Inline fulcrum row (admin only) */}
			{isAdmin && userId && fulcrum && (
				<div className="flex items-center gap-2 pl-11">
					<div
						className={cn(
							'flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border flex-1 min-w-0',
							latestReport?.status === 'completed' && 'cursor-pointer hover:bg-muted/50 transition-colors',
						)}
						onClick={
							latestReport?.status === 'completed'
								? () => onViewReport(latestReport.id, character.characterName)
								: undefined
						}
					>
						<Scan className="h-3 w-3 text-muted-foreground shrink-0" />
						<span className="font-medium text-muted-foreground shrink-0">Fulcrum Report</span>
						<span className="text-muted-foreground">·</span>
						{latestReport ? (
							latestReport.status === 'completed' ? (
								<>
									<span className="text-foreground truncate">
										View latest report ({formatDistanceToNow(new Date(latestReport.createdAt), { addSuffix: true })})
									</span>
									<ExternalLink className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
								</>
							) : latestReport.status === 'pending' || latestReport.status === 'processing' ? (
								<span className="text-muted-foreground truncate">
									Processing… ({formatDistanceToNow(new Date(latestReport.createdAt), { addSuffix: true })})
								</span>
							) : (
								<span className="text-muted-foreground truncate">
									Failed ({formatDistanceToNow(new Date(latestReport.createdAt), { addSuffix: true })})
								</span>
							)
						) : (
							<span className="text-muted-foreground truncate">No report yet</span>
						)}
					</div>
					{!hasPending && (
						<Button
							variant="ghost"
							size="sm"
							disabled={isRequesting}
							onClick={() =>
								onRequestReport.mutate({
									characterId: character.characterId,
									corporationId,
									requestSource: 'hr',
									userId,
								})
							}
						>
							{isRequesting ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<>
									<Scan className="h-3.5 w-3.5 mr-1.5" />
									{latestReport ? 'Rescan' : 'Scan'}
								</>
							)}
						</Button>
					)}
				</div>
			)}
		</div>
	)
}

function NoteCard({ note }: { note: HRNote }) {
	const typeColors: Record<string, string> = {
		general: 'text-blue-400',
		warning: 'text-yellow-400',
		positive: 'text-green-400',
		incident: 'text-red-400',
		background_check: 'text-purple-400',
	}

	const priorityVariant: Record<string, 'default' | 'warning' | 'destructive'> = {
		low: 'default',
		normal: 'default',
		high: 'warning',
		critical: 'destructive',
	}

	return (
		<div className="rounded-lg border p-4 space-y-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className={cn('text-xs font-medium capitalize', typeColors[note.noteType])}>
						{note.noteType.replace('_', ' ')}
					</span>
					{note.priority !== 'normal' && (
						<Badge variant={priorityVariant[note.priority] ?? 'default'} className="text-[10px] px-1.5 py-0">
							{note.priority}
						</Badge>
					)}
				</div>
				<span className="text-xs text-muted-foreground">
					{formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
				</span>
			</div>
			<p className="text-sm leading-relaxed">{note.noteText}</p>
			<p className="text-xs text-muted-foreground">by {note.authorCharacterName}</p>
		</div>
	)
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

	// Permissions
	const { data: permission, isLoading: permissionLoading } = useHrPermissionCheck(
		corporationId ? { corporationId } : null,
	)

	// Fetch all members and find this account
	const { data: membersResponse, isLoading: membersLoading } = useCorporationMembers(
		corporationId ?? '',
		{}
	)
	const members = membersResponse?.items ?? []

	const account = useMemo(() => {
		if (!accountId) return null
		const groups = groupByAccount(members)
		return groups.find((g) => g.accountId === accountId) ?? null
	}, [members, accountId])

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
				isInCorp: false,
				fulcrum: fc,
			}))

		return [...inCorp, ...external]
	}, [account, fulcrumCharacters])

	const totalCharacters = unifiedCharacters.length

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
				: '/hr/auditor/users')
		return (
			<Navigate
				to={`/hr/auditor/users/${accountId}`}
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
					Back
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
									{account.characters.length} in corp
									{totalCharacters > account.characters.length && (
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
					{/* Characters */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<Users className="h-4 w-4" />
								Characters ({totalCharacters})
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2">
							{unifiedCharacters.map((char) => (
								<CharacterCard
									key={char.characterId}
									character={char}
									corporationId={corporationId}
									userId={authUserId}
									isAdmin={isAdmin}
									onRequestReport={requestReport}
									onViewReport={(reportId, characterName) =>
										navigate(`/fulcrum/reports/${reportId}`, {
											state: {
												characterName,
												userId: accountId,
												corporationId,
												returnTo: `/corporations/${corporationId}/members/${accountId}`,
												backLabel: 'Back to User Profile',
												breadcrumbParentLabel: 'User Profile',
											},
										})
									}
								/>
							))}
							{fulcrumLoading && unifiedCharacters.length === account.characters.length && (
								<div className="flex items-center justify-center py-2 text-xs text-muted-foreground gap-2">
									<Loader2 className="h-3 w-3 animate-spin" />
									Loading characters…
								</div>
							)}
						</CardContent>
					</Card>

					{/* HR Notes (Admin + Auditor) */}
					{(isAdmin || isAuditor) && authUserId && (
						<Card>
							<CardHeader>
								<div className="flex items-center justify-between">
									<CardTitle className="flex items-center gap-2 text-base">
										<FileText className="h-4 w-4" />
										HR Notes
									</CardTitle>
									{canAddNote && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setAddNoteOpen(true)}
										>
											<MessageSquarePlus className="h-3.5 w-3.5 mr-1.5" />
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
											<NoteCard key={note.id} note={note} />
										))}
									</div>
								) : (
									<p className="text-sm text-muted-foreground text-center py-4">
										No HR notes for this account
									</p>
								)}
							</CardContent>
						</Card>
					)}

					{/* Application History */}
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<User className="h-4 w-4" />
								Application History
							</CardTitle>
						</CardHeader>
						<CardContent>
							{!account.isLinked ? (
								<p className="text-sm text-muted-foreground text-center py-4">
									Unregistered member — no application data
								</p>
							) : appsLoading ? (
								<div className="flex justify-center py-6">
									<LoadingSpinner size="sm" />
								</div>
							) : sortedApps.length > 0 ? (
								<div className="space-y-2">
									{sortedApps.map((app) => (
										<div
											key={app.id}
											className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
											onClick={() =>
												navigate(
													`/corporations/${corporationId}/applications/${app.id}`,
												)
											}
										>
											<div className="flex items-center gap-3">
												<MemberAvatar
													characterId={app.characterId}
													characterName={app.characterName}
													size="sm"
												/>
												<div>
													<p className="text-sm font-medium">{app.characterName}</p>
													<p className="text-xs text-muted-foreground">
														{formatDistanceToNow(new Date(app.createdAt), {
															addSuffix: true,
														})}
													</p>
												</div>
											</div>
											<div className="flex items-center gap-2">
												<ApplicationStatusBadge status={app.status} size="sm" />
												<ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
											</div>
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground text-center py-4">
									No applications found
								</p>
							)}
						</CardContent>
					</Card>
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
		</Container>
	)
}
