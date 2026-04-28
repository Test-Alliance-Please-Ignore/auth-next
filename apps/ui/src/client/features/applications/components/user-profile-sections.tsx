import { formatDistanceToNow } from 'date-fns'
import { ExternalLink, FileText, Loader2, MessageSquarePlus, Scan, User, Users } from 'lucide-react'

import { getEsiStatusBadgeState } from '@/components/esi-status-badge'
import { MemberAvatar } from '@/components/member-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/ui/loading'
import { cn } from '@/lib/utils'

import { ApplicationStatusBadge } from './application-status-badge'
import { CharacterIdentitySummary } from './character-identity-summary'

import type { CharacterReportMetadata, HRNote } from '../api'

export interface SharedProfileCharacter {
	characterId: string
	characterName: string
	hasValidToken: boolean | null | undefined
	corporationId?: string | null
	corporationName?: string | null
	allianceId?: string | null
	allianceName?: string | null
	role?: 'CEO' | 'Director' | 'Member' | null
	activityStatus?: 'active' | 'inactive' | 'unknown' | null
	isPrimary?: boolean
	isBlacklisted?: boolean
	lastLogin?: string
	joinDate?: string
	locationSystem?: string
	locationRegion?: string
	skillPoints?: number | null
	walletBalance?: string | null
	isMetricsLoading?: boolean
	isExternal?: boolean
	latestReport?: CharacterReportMetadata | null
	hasPendingReport?: boolean
}

export interface SharedProfileApplication {
	id: string
	corporationId: string
	corporationName?: string | null
	characterId: string
	characterName: string
	status: string
	createdAt: string
}

function resolveEsiBadge(character: SharedProfileCharacter) {
	return getEsiStatusBadgeState({
		hasAuthAccount: true,
		hasValidToken: character.hasValidToken ?? null,
	})
}

export function ProfileCharactersSection({
	characters,
	fulcrumLoading = false,
	showViewDetailsButton = false,
	isScanAllVisible = false,
	isScanningAll = false,
	scanAllLabel,
	scanAllDisabled = false,
	onScanAll,
	isScanPendingFor,
	onScan,
	onViewReport,
	onViewDetails,
	noDataText = 'No linked characters found',
}: {
	characters: SharedProfileCharacter[]
	fulcrumLoading?: boolean
	showViewDetailsButton?: boolean
	isScanAllVisible?: boolean
	isScanningAll?: boolean
	scanAllLabel?: string
	scanAllDisabled?: boolean
	onScanAll?: () => void
	isScanPendingFor?: (characterId: string) => boolean
	onScan: (character: SharedProfileCharacter) => void
	onViewReport: (character: SharedProfileCharacter) => void
	onViewDetails?: (character: SharedProfileCharacter) => void
	noDataText?: string
}) {
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-2">
					<CardTitle className="flex items-center gap-2 text-base">
						<Users className="h-4 w-4" />
						Characters ({characters.length})
					</CardTitle>
					{isScanAllVisible && (
						<Button
							variant="ghost"
							size="sm"
							onClick={onScanAll}
							disabled={scanAllDisabled}
						>
							<Scan className={`mr-1.5 h-3.5 w-3.5 ${isScanningAll ? 'animate-spin' : ''}`} />
							{scanAllLabel ?? 'Scan All'}
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{fulcrumLoading ? (
					<div className="flex justify-center py-6">
						<LoadingSpinner size="sm" />
					</div>
				) : characters.length === 0 ? (
					<p className="py-6 text-center text-sm text-muted-foreground">{noDataText}</p>
				) : (
					<div className="space-y-2">
						{characters.map((character) => {
							const esiBadge = resolveEsiBadge(character)
							const isScanPending = isScanPendingFor?.(character.characterId) ?? false
							return (
								<div key={character.characterId} className="space-y-2 rounded-lg border px-3 py-2">
									<CharacterIdentitySummary
										characterId={character.characterId}
										characterName={character.characterName}
										hasValidToken={character.hasValidToken}
										corporationId={character.corporationId}
										corporationName={character.corporationName}
										allianceId={character.allianceId}
										allianceName={character.allianceName}
										skillPoints={character.skillPoints}
										walletBalance={character.walletBalance}
										isMetricsLoading={character.isMetricsLoading}
										nameBadges={
											<>
												{character.isPrimary && (
													<Badge
														variant="default"
														className="bg-blue-500/20 px-1.5 py-0 text-[10px] text-blue-500"
													>
														Primary
													</Badge>
												)}
												{character.isExternal && (
													<Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
														External
													</Badge>
												)}
												{(character.role === 'CEO' || character.role === 'Director') && (
													<span
														className={cn(
															'text-xs',
															character.role === 'CEO' && 'font-bold text-yellow-500',
															character.role === 'Director' && 'font-semibold text-blue-400'
														)}
													>
														{character.role}
													</span>
												)}
												{character.activityStatus && character.activityStatus !== 'unknown' && (
													<Badge
														variant={
															character.activityStatus === 'active'
																? 'success'
																: character.activityStatus === 'inactive'
																	? 'destructive'
																	: 'secondary'
														}
														className="px-1.5 py-0 text-[10px]"
													>
														{character.activityStatus}
													</Badge>
												)}
												{character.isBlacklisted && (
													<Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
														Blacklisted
													</Badge>
												)}
											</>
										}
									/>
									<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
										{character.lastLogin && (
											<span
												title="Last active is based on the most recent ESI member-tracking login timestamp."
											>
												Last active {formatDistanceToNow(new Date(character.lastLogin), { addSuffix: true })}
											</span>
										)}
										{character.joinDate && (
											<span>
												Joined {formatDistanceToNow(new Date(character.joinDate), { addSuffix: true })}
											</span>
										)}
									</div>
									<div className="flex items-center gap-2">
										<div
											className={cn(
												'flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs',
												character.latestReport?.status === 'completed' &&
													character.corporationId &&
													'cursor-pointer transition-colors hover:bg-muted/50'
											)}
											onClick={() => onViewReport(character)}
										>
											<Scan className="h-3 w-3 shrink-0 text-muted-foreground" />
											<span className="shrink-0 font-medium text-muted-foreground">Fulcrum Report</span>
											<span className="shrink-0 text-muted-foreground">·</span>
											{character.latestReport ? (
												character.latestReport.status === 'completed' ? (
													<>
														<span className="truncate text-foreground">
															View latest report (
															{formatDistanceToNow(new Date(character.latestReport.createdAt), { addSuffix: true })}
															)
														</span>
														<ExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
													</>
												) : character.latestReport.status === 'pending' ||
												  character.latestReport.status === 'processing' ? (
													<span className="truncate text-muted-foreground">
														Processing... (
														{formatDistanceToNow(new Date(character.latestReport.createdAt), { addSuffix: true })}
														)
													</span>
												) : (
													<span className="truncate text-muted-foreground">
														Failed (
														{formatDistanceToNow(new Date(character.latestReport.createdAt), { addSuffix: true })}
														)
													</span>
												)
											) : (
												<span className="truncate text-muted-foreground">No report yet</span>
											)}
										</div>
										{showViewDetailsButton && onViewDetails && (
											<Button variant="ghost" size="sm" onClick={() => onViewDetails(character)}>
												<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
												View Details
											</Button>
										)}
										<Button
											variant={character.latestReport ? 'ghost' : 'primary'}
											size="sm"
											disabled={!character.corporationId || character.hasPendingReport || isScanPending}
											onClick={() => onScan(character)}
										>
											{isScanPending ? (
												<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
											) : (
												<Scan className="mr-1.5 h-3.5 w-3.5" />
											)}
											{isScanPending ? 'Requesting...' : 'Scan'}
										</Button>
									</div>
								</div>
							)
						})}
					</div>
				)}
			</CardContent>
		</Card>
	)
}

export function ProfileNotesSection({
	notes,
	loading = false,
	canAddNote = false,
	onAddNote,
	emptyText = 'No notes for this user',
}: {
	notes?: HRNote[]
	loading?: boolean
	canAddNote?: boolean
	onAddNote?: () => void
	emptyText?: string
}) {
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="flex items-center gap-2 text-base">
						<FileText className="h-4 w-4" />
						HR Notes
					</CardTitle>
					{canAddNote && (
						<Button variant="ghost" size="sm" onClick={onAddNote}>
							<MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
							Add Note
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{loading ? (
					<div className="flex justify-center py-6">
						<LoadingSpinner size="sm" />
					</div>
				) : notes && notes.length > 0 ? (
					<div className="space-y-3">
						{notes.map((note) => (
							<div key={note.id} className="space-y-2 rounded-lg border p-4">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<Badge variant={note.authorIsAdmin ? 'default' : 'secondary'}>
											{note.authorIsAdmin || note.source === 'admin' ? 'Admin' : 'HR'}
										</Badge>
										<span className="text-xs text-muted-foreground">by {note.authorCharacterName}</span>
									</div>
									<span className="text-xs text-muted-foreground">
										{formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
									</span>
								</div>
								<p className="whitespace-pre-wrap text-sm">{note.noteText}</p>
							</div>
						))}
					</div>
				) : (
					<p className="py-4 text-center text-sm text-muted-foreground">{emptyText}</p>
				)}
			</CardContent>
		</Card>
	)
}

export function ProfileApplicationHistorySection({
	applications,
	loading = false,
	linked = true,
	onOpenApplication,
	emptyText = 'No application history',
	unlinkedText = 'Unregistered member — no application data',
}: {
	applications: SharedProfileApplication[]
	loading?: boolean
	linked?: boolean
	onOpenApplication: (application: SharedProfileApplication) => void
	emptyText?: string
	unlinkedText?: string
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					<User className="h-4 w-4" />
					Application History
				</CardTitle>
			</CardHeader>
			<CardContent>
				{!linked ? (
					<p className="py-4 text-center text-sm text-muted-foreground">{unlinkedText}</p>
				) : loading ? (
					<div className="flex justify-center py-6">
						<LoadingSpinner size="sm" />
					</div>
				) : applications.length > 0 ? (
					<div className="space-y-2">
						{applications.map((application) => (
							<div
								key={application.id}
								className="flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
								onClick={() => onOpenApplication(application)}
							>
								<div className="flex items-center gap-3">
									<MemberAvatar
										characterId={application.characterId}
										characterName={application.characterName}
										size="sm"
									/>
									<div>
										<p className="text-sm font-medium">{application.characterName}</p>
										<p className="text-xs text-muted-foreground">
											{formatDistanceToNow(new Date(application.createdAt), { addSuffix: true })}
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<ApplicationStatusBadge status={application.status} size="sm" />
									<ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
								</div>
							</div>
						))}
					</div>
				) : (
					<p className="py-4 text-center text-sm text-muted-foreground">{emptyText}</p>
				)}
			</CardContent>
		</Card>
	)
}
