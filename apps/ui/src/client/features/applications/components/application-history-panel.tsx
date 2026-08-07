/**
 * Application History Panel Component
 *
 * Shows prior applications split into two sections:
 * 1. This Character — all apps by this character (across any account that owned it)
 * 2. This Account — all apps by other characters on the same user account
 */

import { formatDistanceToNow } from 'date-fns'
import { FileText, History, User, Users } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'

import { MemberAvatar } from '@/components/member-avatar'
import { LoadingSpinner } from '@/components/ui/loading'

import { useCharacterApplicationHistory, useUserApplicationHistory } from '../hooks'
import { ApplicationStatusBadge } from './application-status-badge'

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
			<MemberAvatar characterId={app.characterId} characterName={app.characterName} size="md" />
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

function HistorySection({
	title,
	icon: Icon,
	apps,
	emptyMessage,
	onNavigate,
}: {
	title: string
	icon: typeof User
	apps: Application[]
	emptyMessage: string
	onNavigate: (applicationId: string) => void
}) {
	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
				<Icon className="h-4 w-4" />
				<span>{title}</span>
				<span className="text-xs">({apps.length})</span>
			</div>
			{apps.length === 0 ? (
				<p className="py-2 text-sm text-muted-foreground/70">{emptyMessage}</p>
			) : (
				apps.map((app) => <HistoryEntry key={app.id} app={app} onNavigate={onNavigate} />)
			)}
		</div>
	)
}

// ============================================================================
// Main Component
// ============================================================================

interface ApplicationHistoryPanelProps {
	characterId: string
	userId: string
	applicationId: string
}

export function ApplicationHistoryPanel({
	characterId,
	userId,
	applicationId,
}: ApplicationHistoryPanelProps) {
	const { corporationId } = useParams<{ corporationId: string }>()
	const navigate = useNavigate()
	const {
		data: charHistory,
		isLoading: charLoading,
		error: charError,
	} = useCharacterApplicationHistory(characterId, applicationId)
	const {
		data: userHistory,
		isLoading: userLoading,
		error: userError,
	} = useUserApplicationHistory(userId, applicationId)

	const handleNavigate = (targetApplicationId: string) => {
		void navigate(`/corporations/${corporationId}/applications/${targetApplicationId}`)
	}

	const isLoading = charLoading || userLoading
	const error = charError || userError

	// Filter user history to exclude apps already shown in the character section
	const charAppIds = new Set((charHistory ?? []).map((a) => a.id))
	const otherAccountApps = (userHistory ?? []).filter(
		(a) => !charAppIds.has(a.id) && a.characterId !== characterId
	)

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

	const hasCharHistory = (charHistory?.length ?? 0) > 0
	const hasAccountHistory = otherAccountApps.length > 0

	if (!hasCharHistory && !hasAccountHistory) {
		return (
			<div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
				<History className="h-8 w-8 opacity-50" />
				<p>No prior applications found</p>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<HistorySection
				title="This Character"
				icon={User}
				apps={charHistory ?? []}
				emptyMessage="No prior applications from this character"
				onNavigate={handleNavigate}
			/>
			<HistorySection
				title="This Account (Other Characters)"
				icon={Users}
				apps={otherAccountApps}
				emptyMessage="No applications from other characters on this account"
				onNavigate={handleNavigate}
			/>
		</div>
	)
}
