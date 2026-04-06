/**
 * Fulcrum Panel Component
 *
 * Displays all characters linked to an applicant's account and their
 * Fulcrum character report status. HR reviewers/admins can request
 * new reports or re-request expired ones.
 */

import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, Clock, ExternalLink, FileText, Loader2, RefreshCw, Users } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

import { MemberAvatar } from '@/components/member-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading'

import { useApplicationFulcrum, useRequestFulcrumReport } from '../hooks'

import type { CharacterReportMetadata, FulcrumCharacterData } from '../api'

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
			return <Badge variant="outline">{status}</Badge>
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
	character: FulcrumCharacterData
	onRequest: (characterId: string) => void
	onViewReport: (reportId: string, characterName: string) => void
	isRequesting: boolean
	requestingCharacterId: string | null
}

function CharacterReportCard({
	character,
	onRequest,
	onViewReport,
	isRequesting,
	requestingCharacterId,
}: CharacterReportCardProps) {
	const latestReport = getLatestReport(character.reports)
	const canRequest = canRequestNewReport(character.reports)
	const isThisRequesting = isRequesting && requestingCharacterId === character.characterId

	return (
		<div className="flex items-start gap-4 rounded-lg border p-4">
			<MemberAvatar
				characterId={character.characterId}
				characterName={character.characterName}
				size="lg"
			/>

			<div className="min-w-0 flex-1 space-y-2">
				{/* Character Info */}
				<div>
					<h4 className="font-medium text-foreground">{character.characterName}</h4>
					{character.corporationName && (
						<p className="text-sm text-muted-foreground">{character.corporationName}</p>
					)}
				</div>

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
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onViewReport(latestReport.id, character.characterName)}
					>
						<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
						View
					</Button>
				)}

				{canRequest && (
					<Button
						variant={latestReport ? 'ghost' : 'primary'}
						size="sm"
						onClick={() => onRequest(character.characterId)}
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
}

export function FulcrumPanel({ userId, corporationId, applicationId }: FulcrumPanelProps) {
	const { corporationId: routeCorporationId } = useParams<{ corporationId: string }>()
	const navigate = useNavigate()
	const { data: characters, isLoading, error } = useApplicationFulcrum(userId, corporationId)
	const requestReport = useRequestFulcrumReport()

	const handleRequest = (characterId: string) => {
		requestReport.mutate({
			characterId,
			corporationId,
			requestSource: 'hr',
			applicationId,
			userId,
		})
	}

	const handleViewReport = (reportId: string, characterName: string) => {
		const params = new URLSearchParams({ char: characterName })
		if (applicationId) {
			navigate(
				`/corporations/${routeCorporationId}/hr/applications/${applicationId}/report/${reportId}?${params}`,
			)
		} else {
			navigate(
				`/corporations/${routeCorporationId}/hr/report/${reportId}?${params}`,
			)
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

	if (!characters || characters.length === 0) {
		return (
			<p className="text-center text-muted-foreground py-8">
				No linked characters found for this applicant
			</p>
		)
	}

	const requestableCharacters = characters.filter((c) => canRequestNewReport(c.reports))

	const handleRequestAll = () => {
		for (const character of requestableCharacters) {
			requestReport.mutate({
				characterId: character.characterId,
				corporationId,
				requestSource: 'hr',
				applicationId,
				userId,
			})
		}
	}

	return (
		<div className="space-y-3">
			{requestableCharacters.length > 1 && (
				<div className="flex justify-end">
					<Button
						variant="ghost"
						size="sm"
						onClick={handleRequestAll}
						disabled={requestReport.isPending}
					>
						{requestReport.isPending ? (
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						) : (
							<Users className="mr-1.5 h-3.5 w-3.5" />
						)}
						Generate All Reports
					</Button>
				</div>
			)}
			{characters.map((character) => (
				<CharacterReportCard
					key={character.characterId}
					character={character}
					onRequest={handleRequest}
					onViewReport={handleViewReport}
					isRequesting={requestReport.isPending}
					requestingCharacterId={
						requestReport.isPending
							? (requestReport.variables?.characterId ?? null)
							: null
					}
				/>
			))}
		</div>
	)
}
