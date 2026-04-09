/**
 * Application History Panel Component
 *
 * Shows prior applications made by the same character,
 * regardless of which account owned the character at the time.
 */

import { formatDistanceToNow } from 'date-fns'
import { FileText, History } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

import { MemberAvatar } from '@/components/member-avatar'
import { LoadingSpinner } from '@/components/ui/loading'

import { ApplicationStatusBadge } from './application-status-badge'
import { useCharacterApplicationHistory } from '../hooks'

import type { Application } from '../api'

// ============================================================================
// Sub-Components
// ============================================================================

function HistoryEntry({
	app,
	onNavigate,
}: {
	app: Application
	onNavigate: (applicationId: string) => void
}) {
	return (
		<button
			type="button"
			onClick={() => onNavigate(app.id)}
			className="flex w-full cursor-pointer items-start gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-accent/50"
		>
			<MemberAvatar
				characterId={app.characterId}
				characterName={app.characterName}
				size="md"
			/>
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex items-center gap-2">
					<span className="font-medium text-foreground">{app.characterName}</span>
					<ApplicationStatusBadge status={app.status} size="sm" />
				</div>
				<p className="text-sm text-muted-foreground">
					{app.corporationName ?? 'Unknown Corporation'}
				</p>
				<p className="text-xs text-muted-foreground">
					{formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
				</p>
			</div>
		</button>
	)
}

// ============================================================================
// Main Component
// ============================================================================

interface ApplicationHistoryPanelProps {
	characterId: string
	applicationId: string
}

export function ApplicationHistoryPanel({ characterId, applicationId }: ApplicationHistoryPanelProps) {
	const { corporationId } = useParams<{ corporationId: string }>()
	const navigate = useNavigate()
	const { data: history, isLoading, error } = useCharacterApplicationHistory(characterId, applicationId)

	const handleNavigate = (targetApplicationId: string) => {
		navigate(`/corporations/${corporationId}/hr/applications/${targetApplicationId}`)
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
				<FileText className="h-5 w-5" />
				<p>Failed to load application history: {error.message}</p>
			</div>
		)
	}

	if (!history || history.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
				<History className="h-8 w-8 opacity-50" />
				<p>No prior applications found for this character</p>
			</div>
		)
	}

	return (
		<div className="space-y-3">
			<p className="text-sm text-muted-foreground">
				{history.length} prior {history.length === 1 ? 'application' : 'applications'} found
			</p>
			{history.map((app) => (
				<HistoryEntry key={app.id} app={app} onNavigate={handleNavigate} />
			))}
		</div>
	)
}
