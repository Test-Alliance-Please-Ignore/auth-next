/**
 * Fulcrum Panel Component
 *
 * Displays all characters linked to an applicant's account and their
 * Fulcrum character report status. HR reviewers/admins can request
 * new reports or re-request expired ones.
 */

import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, Clock, ExternalLink, FileText, Loader2, RefreshCw, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { CharacterIdentitySummary } from './character-identity-summary'

import {
	useFulcrumUserReports,
	useHrUserCharacters,
	useRequestFulcrumReport,
	useRequestFulcrumReportBatch,
} from '../hooks'

import type { CharacterReportMetadata } from '../api'

const SEND_DM_PREF_KEY = 'fulcrum:scan-all:send-dm'

function getInitialSendDmPreference(): boolean {
	if (typeof window === 'undefined') return true
	const raw = window.localStorage.getItem(SEND_DM_PREF_KEY)
	return raw === null ? true : raw === 'true'
}

// ============================================================================
// Report Status Helpers
// ============================================================================

function getReportStatusBadge(status: string) {
	switch (status) {
		case 'completed':
			return <Badge variant="success">Completed</Badge>
		case 'pending':
		case 'processing':
			return <Badge variant="default">In Progress</Badge>
		case 'failed':
			return <Badge variant="destructive">Failed</Badge>
		case 'expired':
			return <Badge variant="warning">Expired</Badge>
		case 'cancelled':
			return <Badge variant="secondary">Cancelled</Badge>
		default:
			return <Badge variant="secondary">{status}</Badge>
	}
}

function getLatestReport(reports: CharacterReportMetadata[]): CharacterReportMetadata | null {
	if (reports.length === 0) return null
	return reports.reduce((latest, r) =>
		new Date(r.createdAt) > new Date(latest.createdAt) ? r : latest,
	)
}

function canRequestNewReport(reports: CharacterReportMetadata[]): boolean {
	return !reports.some((r) => r.status === 'pending' || r.status === 'processing')
}

// ============================================================================
// Sub-Components
// ============================================================================

interface CharacterReportCardProps {
	character: PanelCharacterRow
	onRequest: () => void
	getReportTarget: (reportId: string, characterName: string) => {
		pathname: string
		search: string
		state: {
			characterName: string
			userId: string
			corporationId: string
			returnTo: string
			backLabel: string
			breadcrumbParentLabel: string
		}
	}
	isRequesting: boolean
	requestingCharacterId: string | null
	canRequest: boolean
}

interface PanelCharacterRow {
	characterId: string
	characterName: string
	corporationId: string | null
	corporationName: string | null
	allianceId: string | null
	allianceName: string | null
	hasValidToken: boolean | null
	role: 'CEO' | 'Director' | 'Member' | null
	activityStatus: 'active' | 'inactive' | 'unknown' | null
	reports: CharacterReportMetadata[]
}

function CharacterReportCard({
	character,
	onRequest,
	getReportTarget,
	isRequesting,
	requestingCharacterId,
	canRequest,
}: CharacterReportCardProps) {
	const latestReport = getLatestReport(character.reports)
	const isThisRequesting =
		isRequesting && (requestingCharacterId === null || requestingCharacterId === character.characterId)

	return (
		<div className="card-gradient flex items-start gap-4 rounded-lg border border-border/50 bg-card p-4 shadow-elevated">
			<div className="min-w-0 flex-1 space-y-2">
				<CharacterIdentitySummary
					characterId={character.characterId}
					characterName={character.characterName}
					hasValidToken={character.hasValidToken}
					corporationId={character.corporationId}
					corporationName={character.corporationName}
					allianceId={character.allianceId}
					allianceName={character.allianceName}
					showMetrics={false}
				/>

				{/* Report Status */}
				{latestReport ? (
					<div className="space-y-1.5">
						<div className="flex items-center gap-2">
							{getReportStatusBadge(latestReport.status)}
							<span className="text-xs text-muted-foreground">
								{formatDistanceToNow(new Date(latestReport.createdAt), { addSuffix: true })}
							</span>
						</div>

						{latestReport.status === 'completed' && latestReport.expiresAt && (
							<div className="flex items-center gap-1 text-xs text-muted-foreground">
								<Clock className="h-3 w-3" />
								Expires{' '}
								{formatDistanceToNow(new Date(latestReport.expiresAt), { addSuffix: true })}
							</div>
						)}

						{latestReport.status === 'failed' && latestReport.errorMessage && (
							<div className="flex items-center gap-1 text-xs text-destructive">
								<AlertCircle className="h-3 w-3" />
								{latestReport.errorMessage}
							</div>
						)}

						{(latestReport.status === 'pending' || latestReport.status === 'processing') && (
							<div className="flex items-center gap-1 text-xs text-muted-foreground">
								<Loader2 className="h-3 w-3 animate-spin" />
								Report is being generated...
							</div>
						)}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">No reports generated yet</p>
				)}
			</div>

			{/* Actions */}
			<div className="flex flex-col gap-2">
				{latestReport?.status === 'completed' && (
					<Button asChild variant="ghost" size="sm">
						<Link to={getReportTarget(latestReport.id, character.characterName)}>
							<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
							View
						</Link>
					</Button>
				)}

				{canRequest && (
					<Button
						variant={latestReport ? 'ghost' : 'primary'}
						size="sm"
						onClick={onRequest}
						disabled={isThisRequesting}
					>
						{isThisRequesting ? (
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						) : latestReport ? (
							<RefreshCw className="mr-1.5 h-3.5 w-3.5" />
						) : (
							<FileText className="mr-1.5 h-3.5 w-3.5" />
						)}
						{latestReport ? 'New Report' : 'Request Report'}
					</Button>
				)}
			</div>
		</div>
	)
}

// ============================================================================
// Main Component
// ============================================================================

interface FulcrumPanelProps {
	userId: string
	corporationId: string
	applicationId?: string
	mainCharacterId?: string
	altCharacterIds?: string[]
	canRequestCharacterReport?: (character: PanelCharacterRow) => boolean
	enabled?: boolean
}

export function FulcrumPanel({
	userId,
	corporationId,
	applicationId,
	mainCharacterId,
	altCharacterIds = [],
	canRequestCharacterReport,
	enabled = true,
}: FulcrumPanelProps) {
	const { corporationId: routeCorporationId } = useParams<{ corporationId: string }>()
	const { data: reportCharacters = [], isLoading, error } = useFulcrumUserReports(userId, enabled)
	const { data: hrCharacters = [] } = useHrUserCharacters(userId, {
		enabled: !!userId && enabled,
	})
	const hrCharacterById = useMemo(
		() => new Map(hrCharacters.map((character) => [character.characterId, character])),
		[hrCharacters]
	)
	const reportCharacterById = useMemo(
		() => new Map(reportCharacters.map((character) => [character.characterId, character])),
		[reportCharacters]
	)
	const characters = useMemo<PanelCharacterRow[]>(() => {
		const combinedCharacterIds = new Set<string>([
			...reportCharacters.map((character) => character.characterId),
			...hrCharacters.map((character) => character.characterId),
		])
		return [...combinedCharacterIds].map((characterId) => {
			const reportCharacter = reportCharacterById.get(characterId)
			const hrCharacter = hrCharacterById.get(characterId)
			return {
				characterId,
				characterName: hrCharacter?.characterName ?? characterId,
				corporationId: hrCharacter?.corporationId ?? null,
				corporationName: hrCharacter?.corporationName ?? null,
				allianceId: hrCharacter?.allianceId ?? null,
				allianceName: hrCharacter?.allianceName ?? null,
				hasValidToken: hrCharacter?.hasValidToken ?? null,
				role: reportCharacter?.role ?? null,
				activityStatus: reportCharacter?.activityStatus ?? null,
				reports: reportCharacter?.reports ?? [],
			}
		})
	}, [hrCharacterById, hrCharacters, reportCharacterById, reportCharacters])
	const requestReport = useRequestFulcrumReport()
	const requestReportBatch = useRequestFulcrumReportBatch()
	const [sendDmForScanRequests, setSendDmForScanRequests] = useState(getInitialSendDmPreference)
	const [scanAllDialogOpen, setScanAllDialogOpen] = useState(false)
	const [scanSingleDialogCharacter, setScanSingleDialogCharacter] = useState<PanelCharacterRow | null>(null)
	const [isRequestingAll, setIsRequestingAll] = useState(false)

	if (!enabled) {
		return null
	}

	const persistSendDmPreference = (enabled: boolean) => {
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(SEND_DM_PREF_KEY, enabled ? 'true' : 'false')
		}
	}

	const requestCharacterReport = (characterId: string, sendDm: boolean) => {
		requestReport.mutate({
			characterId,
			corporationId,
			requestSource: 'hr',
			applicationId,
			userId,
			sendDm,
		})
	}

	const getReportTarget = (reportId: string, characterName: string) => {
		const resolvedCorporationId = routeCorporationId ?? corporationId
		const returnTo = applicationId
			? `/corporations/${resolvedCorporationId}/applications/${applicationId}`
			: `/corporations/${resolvedCorporationId}/members/${userId}`
		const backLabel = applicationId ? 'Back to Application' : 'Back to User Profile'
		const breadcrumbParentLabel = applicationId ? 'Application' : 'User Profile'
		const search = new URLSearchParams({
			characterName,
			userId,
			corporationId,
			returnTo,
			backLabel,
			breadcrumbParentLabel,
		}).toString()
		return {
			pathname: applicationId
				? `/corporations/${resolvedCorporationId}/applications/${applicationId}/reports/${reportId}`
				: `/fulcrum/reports/${reportId}`,
			search: `?${search}`,
			state: {
				characterName,
				userId,
				corporationId,
				returnTo,
				backLabel,
				breadcrumbParentLabel,
			},
		}
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-8">
				<LoadingSpinner size="md" />
			</div>
		)
	}

	if (error) {
		return (
			<div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
				<AlertCircle className="h-5 w-5" />
				<p>Failed to load character data: {error.message}</p>
			</div>
		)
	}

	if (characters.length === 0) {
		return (
			<p className="text-center text-muted-foreground py-8">
				No linked characters found for this applicant
			</p>
		)
	}

	const requestableCharacters = characters.filter(
		(character) =>
			canRequestNewReport(character.reports) &&
			(canRequestCharacterReport?.(character) ?? true)
	)

	const handleConfirmSingle = () => {
		if (!scanSingleDialogCharacter || isRequestingAll || requestReport.isPending || requestReportBatch.isPending) return
		persistSendDmPreference(sendDmForScanRequests)
		const characterId = scanSingleDialogCharacter.characterId
		setScanSingleDialogCharacter(null)
		requestCharacterReport(characterId, sendDmForScanRequests)
	}

	const handleConfirmRequestAll = async () => {
		if (requestableCharacters.length === 0 || isRequestingAll || requestReport.isPending || requestReportBatch.isPending) return
		persistSendDmPreference(sendDmForScanRequests)
		setScanAllDialogOpen(false)
		setIsRequestingAll(true)
		try {
			await requestReportBatch.mutateAsync({
				characterIds: requestableCharacters.map((c) => c.characterId),
				corporationId,
				requestSource: 'hr',
				applicationId,
				userId,
				sendDm: sendDmForScanRequests,
			})
		} finally {
			setIsRequestingAll(false)
		}
	}

	const handleOpenSingleDialog = (character: PanelCharacterRow) => {
		if (
			isRequestingAll ||
			requestReport.isPending ||
			requestReportBatch.isPending ||
			!canRequestNewReport(character.reports) ||
			!(canRequestCharacterReport?.(character) ?? true)
		) {
			return
		}
		setScanSingleDialogCharacter(character)
	}

	const handleOpenAllDialog = () => {
		if (
			isRequestingAll ||
			requestReport.isPending ||
			requestReportBatch.isPending ||
			requestableCharacters.length < 2
		) {
			return
		}
		setScanAllDialogOpen(true)
	}

	const isAnyRequestPending = requestReport.isPending || requestReportBatch.isPending || isRequestingAll

	// Split characters into application chars (main + alts) and other chars
	const applicationCharacterIds = mainCharacterId
		? new Set([mainCharacterId, ...altCharacterIds])
		: null
	const applicationCharacters = applicationCharacterIds
		? characters.filter((c) => applicationCharacterIds.has(c.characterId))
		: []
	const otherCharacters = applicationCharacterIds
		? characters.filter((c) => !applicationCharacterIds.has(c.characterId))
		: characters

	const renderCharacterCards = (chars: PanelCharacterRow[]) =>
		chars.map((character) => (
			<CharacterReportCard
				key={character.characterId}
				character={character}
				onRequest={() => handleOpenSingleDialog(character)}
				getReportTarget={getReportTarget}
				isRequesting={isAnyRequestPending}
				canRequest={canRequestNewReport(character.reports) && (canRequestCharacterReport?.(character) ?? true)}
				requestingCharacterId={
					requestReport.isPending
						? (requestReport.variables?.characterId ?? null)
						: null
				}
			/>
		))

	return (
		<div className="space-y-3">
			{requestableCharacters.length > 1 && (
				<div className="flex justify-end">
					<Button
						variant="ghost"
						size="sm"
						onClick={handleOpenAllDialog}
						disabled={isAnyRequestPending}
					>
						{isAnyRequestPending ? (
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						) : (
							<Users className="mr-1.5 h-3.5 w-3.5" />
						)}
						Generate All Reports
					</Button>
				</div>
			)}

			{applicationCharacters.length > 0 && (
				<>
					<h4 className="text-sm font-medium text-muted-foreground">Application Characters</h4>
					{renderCharacterCards(applicationCharacters)}
				</>
			)}

			{applicationCharacters.length > 0 && otherCharacters.length > 0 && (
				<Separator />
			)}

			{otherCharacters.length > 0 && (
				<>
					{applicationCharacters.length > 0 && (
						<h4 className="text-sm font-medium text-muted-foreground">Other Characters</h4>
					)}
					{renderCharacterCards(otherCharacters)}
				</>
			)}

			<Dialog open={scanAllDialogOpen} onOpenChange={setScanAllDialogOpen}>
				<DialogContent className="sm:max-w-[500px]">
					<DialogHeader>
						<DialogTitle>Generate Reports For All Eligible Characters?</DialogTitle>
						<DialogDescription>
							This will queue {requestableCharacters.length} report
							{requestableCharacters.length === 1 ? '' : 's'}.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<label
							htmlFor="fulcrum-panel-scan-all-send-dm"
							className="flex cursor-pointer items-center gap-2 rounded-md border p-3"
						>
							<Checkbox
								id="fulcrum-panel-scan-all-send-dm"
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
						<Button variant="confirm" onClick={() => void handleConfirmRequestAll()}>
							Generate Reports
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={scanSingleDialogCharacter !== null} onOpenChange={(open) => !open && setScanSingleDialogCharacter(null)}>
				<DialogContent className="sm:max-w-[500px]">
					<DialogHeader>
						<DialogTitle>
							Generate Report For {scanSingleDialogCharacter?.characterName ?? 'Character'}?
						</DialogTitle>
						<DialogDescription>
							This will queue one character report.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<label
							htmlFor="fulcrum-panel-single-send-dm"
							className="flex cursor-pointer items-center gap-2 rounded-md border p-3"
						>
							<Checkbox
								id="fulcrum-panel-single-send-dm"
								checked={sendDmForScanRequests}
								onCheckedChange={(checked) => setSendDmForScanRequests(checked === true)}
							/>
							<div>
								<span className="text-sm font-medium leading-none">Send DM for report status</span>
							</div>
						</label>
					</div>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setScanSingleDialogCharacter(null)}>
							Cancel
						</Button>
						<Button variant="confirm" onClick={handleConfirmSingle}>
							Generate Report
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
