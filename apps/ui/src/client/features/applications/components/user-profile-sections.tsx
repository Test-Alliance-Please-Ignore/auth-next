import { formatDistanceToNow } from 'date-fns'
import {
	ChevronDown,
	ExternalLink,
	FileText,
	Loader2,
	MessageSquarePlus,
	Scan,
	User,
	Users,
} from 'lucide-react'

import { MemberAvatar } from '@/components/member-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/ui/loading'
import { cn } from '@/lib/utils'

import { ApplicationStatusBadge } from './application-status-badge'
import { CharacterIdentitySummary } from './character-identity-summary'
import { HRNoteCard } from './hr-note-card'

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
	privateDataUnavailableNote?: string | null
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

export function ProfileCharactersSection({
	characters,
	fulcrumLoading = false,
	showFulcrumReports = true,
	showViewDetailsButton = false,
	isScanAllVisible = false,
	isScanningAll = false,
	scanAllLabel,
	scanAllDisabled = false,
	canRequestReports = true,
	canRequestCharacterReport,
	onScanAll,
	isScanPendingFor,
	onScan,
	onViewReport,
	onViewDetails,
	noDataText = 'No linked characters found',
}: {
	characters: SharedProfileCharacter[]
	fulcrumLoading?: boolean
	showFulcrumReports?: boolean
	showViewDetailsButton?: boolean
	isScanAllVisible?: boolean
	isScanningAll?: boolean
	scanAllLabel?: string
	scanAllDisabled?: boolean
	canRequestReports?: boolean
	canRequestCharacterReport?: (character: SharedProfileCharacter) => boolean
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
					{showFulcrumReports && isScanAllVisible && (
						<Button
							variant="ghost"
							size="sm"
							onClick={onScanAll}
							disabled={scanAllDisabled || !canRequestReports}
						>
							<Scan className={`mr-1.5 h-3.5 w-3.5 ${isScanningAll ? 'animate-spin' : ''}`} />
							{scanAllLabel ?? 'Scan All'}
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent>
				{showFulcrumReports && fulcrumLoading ? (
					<div className="flex justify-center py-6">
						<LoadingSpinner size="sm" />
					</div>
				) : characters.length === 0 ? (
					<p className="py-6 text-center text-sm text-muted-foreground">{noDataText}</p>
				) : (
					<div className="space-y-2">
						{characters.map((character) => {
							const isScanPending = isScanPendingFor?.(character.characterId) ?? false
							const canRequestCharacter = canRequestCharacterReport?.(character) ?? true
							return (
								<div
									key={character.characterId}
									className="card-gradient relative space-y-2 rounded-lg border border-border/50 bg-card px-3 py-2 shadow-elevated"
								>
									{showViewDetailsButton && onViewDetails && (
										<div className="absolute right-2 top-2">
											<Button variant="ghost" size="sm" onClick={() => onViewDetails(character)}>
												<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
												View Details
											</Button>
										</div>
									)}
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
														Blocklisted
													</Badge>
												)}
											</>
										}
									/>
									<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
										{character.joinDate && (
											<span>
												Joined{' '}
												{formatDistanceToNow(new Date(character.joinDate), { addSuffix: true })}
											</span>
										)}
										{character.joinDate && character.lastLogin && <span>•</span>}
										{character.lastLogin && (
											<span title="Last active is based on the most recent ESI member-tracking login timestamp.">
												Last active{' '}
												{formatDistanceToNow(new Date(character.lastLogin), { addSuffix: true })}
											</span>
										)}
									</div>
									{showFulcrumReports && (
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
												<span className="shrink-0 font-medium text-muted-foreground">
													Fulcrum Report
												</span>
												<span className="shrink-0 text-muted-foreground">·</span>
												{character.latestReport ? (
													character.latestReport.status === 'completed' ? (
														<>
															<span className="truncate text-foreground">
																View latest report (
																{formatDistanceToNow(new Date(character.latestReport.createdAt), {
																	addSuffix: true,
																})}
																)
															</span>
															<ExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
														</>
													) : character.latestReport.status === 'pending' ||
													  character.latestReport.status === 'processing' ? (
														<span className="truncate text-muted-foreground">
															Processing... (
															{formatDistanceToNow(new Date(character.latestReport.createdAt), {
																addSuffix: true,
															})}
															)
														</span>
													) : (
														<span className="truncate text-muted-foreground">
															Failed (
															{formatDistanceToNow(new Date(character.latestReport.createdAt), {
																addSuffix: true,
															})}
															)
														</span>
													)
												) : (
													<span className="truncate text-muted-foreground">No report yet</span>
												)}
											</div>

											<Button
												variant={character.latestReport ? 'ghost' : 'primary'}
												size="sm"
												disabled={
													!canRequestReports ||
													!canRequestCharacter ||
													!character.corporationId ||
													character.hasPendingReport ||
													isScanPending
												}
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
									)}
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
	const noteCount = notes?.length ?? 0

	return (
		<Card>
			{noteCount === 0 ? (
				<>
					<CardHeader>
						<div className="flex items-center justify-between">
							<CardTitle className="flex items-center gap-2 text-base">
								<FileText className="h-4 w-4" />
								Account Notes (0)
							</CardTitle>
							{canAddNote && (
								<Button variant="primary" size="sm" onClick={onAddNote}>
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
						) : (
							<p className="py-4 text-center text-sm text-muted-foreground">{emptyText}</p>
						)}
					</CardContent>
				</>
			) : (
				<details className="group">
					<summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4">
						<CardTitle className="flex items-center gap-2 text-base">
							<FileText className="h-4 w-4" />
							Account Notes ({noteCount})
						</CardTitle>
						<div className="pointer-events-auto flex items-center gap-3">
							{canAddNote && (
								<Button
									variant="primary"
									size="sm"
									onClick={(event) => {
										event.preventDefault()
										event.stopPropagation()
										onAddNote?.()
									}}
								>
									<MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
									Add Note
								</Button>
							)}
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<span className="group-open:hidden">Click to expand</span>
								<span className="hidden group-open:inline">Click to collapse</span>
								<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
							</div>
						</div>
					</summary>
					<CardContent className="pt-0">
						{loading ? (
							<div className="flex justify-center py-6">
								<LoadingSpinner size="sm" />
							</div>
						) : (
							<div className="space-y-3">
								{notes?.map((note) => (
									<HRNoteCard key={note.id} note={note} />
								))}
							</div>
						)}
					</CardContent>
				</details>
			)}
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
	const applicationCount = applications.length

	return (
		<Card>
			<details className="group">
				<summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4">
					<CardTitle className="flex items-center gap-2 text-base">
						<User className="h-4 w-4" />
						Application History ({applicationCount})
					</CardTitle>
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span className="group-open:hidden">Click to expand</span>
						<span className="hidden group-open:inline">Click to collapse</span>
						<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
					</div>
				</summary>
				<CardContent className="pt-0">
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
			</details>
		</Card>
	)
}
