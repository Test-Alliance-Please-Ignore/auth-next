import { Search, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { CharacterIdentitySummary } from '@/features/applications/components/character-identity-summary'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Badge } from '@/components/ui/badge'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/ui/loading'
import { useDebounce } from '@/hooks/useDebounce'
import { characterPortraitUrl } from '@/lib/eve-images'
import toast from '@/lib/toast'
import { cn } from '@/lib/utils'

import { useCorporationUserSearch } from '../hooks'

import type { CorporationUserSearchResult } from '../api'

interface CorporationUserSearchDialogProps {
	corporationId: string
	open: boolean
	onOpenChange: (open: boolean) => void
}

function formatUserDisplayName(user: CorporationUserSearchResult['users'][number]): string {
	const mainName = user.summary.mainCharacterName || user.summary.matchedCharacterName || 'Unknown Character'
	const matchedName = user.summary.matchedCharacterName
	const isAltMatch =
		!!user.summary.matchedCharacterId &&
		user.summary.matchedCharacterId !== user.summary.mainCharacterId &&
		!!matchedName

	return isAltMatch ? `${matchedName} (${mainName})` : mainName
}

function CopyableMetaPill({
	label,
	value,
	copied,
	onCopy,
}: {
	label: string
	value: string
	copied: boolean
	onCopy: () => void
}) {
	return (
		<button
			type="button"
			onClick={onCopy}
			className={cn(
				'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-copy',
				copied
					? 'border-emerald-500/60 bg-emerald-500/15 text-muted-foreground'
					: 'border-border/60 bg-background/80 text-muted-foreground hover:border-primary/40'
			)}
			aria-label={`Copy ${label} to clipboard`}
			title={copied ? 'Copied' : `Copy ${label}`}
		>
			<span className="shrink-0 font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
				{label}
			</span>
			<span className="max-w-[18rem] truncate font-mono text-[11px] font-semibold text-white">
				{value}
			</span>
			{copied ? <span className="text-[10px] font-medium text-emerald-300">Copied</span> : null}
		</button>
	)
}

export function CorporationUserSearchDialog({
	corporationId,
	open,
	onOpenChange,
}: CorporationUserSearchDialogProps) {
	const [searchQuery, setSearchQuery] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(10)
	const [copiedField, setCopiedField] = useState<string | null>(null)
	const debouncedQuery = useDebounce(searchQuery.trim(), 400)

	useEffect(() => {
		setPage(1)
	}, [debouncedQuery])

	const limit = pageSize
	const offset = useMemo(() => (page - 1) * pageSize, [page, pageSize])
	const canSearch = open && debouncedQuery.length >= 2
	const { data, isLoading, isFetching, error } = useCorporationUserSearch(
		corporationId,
		{
			search: debouncedQuery,
			limit,
			offset,
		},
		{ enabled: canSearch }
	)

	const users = data?.users ?? []
	const total = data?.total ?? 0
	const totalPages = Math.ceil(total / pageSize)
	const hasPagination = totalPages > 1
	const isSearching = isLoading || isFetching

	const copyToClipboard = (text: string, field: string, label: string) => {
		void navigator.clipboard
			.writeText(text)
			.then(() => {
				toast.success(`${label} copied`)
				setCopiedField(field)
				window.setTimeout(() => {
					setCopiedField((current) => (current === field ? null : current))
				}, 2000)
			})
			.catch(() => {
				toast.error(`Failed to copy ${label.toLowerCase()}`)
			})
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				onOpenChange(nextOpen)
			}}
		>
			<DialogContent className="sm:max-w-5xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Search className="h-5 w-5" />
						User Search
					</DialogTitle>
					<DialogDescription>
						Search by character name, character ID, Discord username, or Discord ID to review the
						linked characters on the account.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<Card>
						<CardContent className="pt-6">
							<div className="space-y-2">
								<div className="relative">
									<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										autoFocus
										placeholder="Search character name, character ID, Discord username, or Discord ID"
										value={searchQuery}
										onChange={(event) => setSearchQuery(event.target.value)}
										className="pl-9"
									/>
								</div>
								<p className="text-xs text-muted-foreground">
									Type at least 2 characters to start searching.
								</p>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardContent className="space-y-4 pt-6">
							{error ? (
								<p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
									{error instanceof Error ? error.message : 'Failed to search users'}
								</p>
							) : null}

							{!canSearch ? (
								<p className="py-10 text-center text-sm text-muted-foreground">
									Enter at least 2 characters to search the user directory.
								</p>
							) : isSearching ? (
								<div className="flex justify-center py-10">
									<LoadingSpinner size="md" />
								</div>
							) : users.length === 0 ? (
								<p className="py-10 text-center text-sm text-muted-foreground">
									No users matched that search.
								</p>
							) : (
								<div className="space-y-4">
									<UserSearchPaginationControls
										totalCount={total}
										page={page}
										pageSize={pageSize}
										onPageChange={setPage}
										onPageSizeChange={(nextPageSize) => {
											setPageSize(nextPageSize)
											setPage(1)
										}}
										pageSizeOptions={[10, 25, 50]}
										itemLabel="users"
									/>

									<div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
										{users.map((user) => {
											const displayName = formatUserDisplayName(user)
											const portraitId =
												user.summary.matchedCharacterId || user.summary.mainCharacterId
											const userIdCopy = `user:${user.summary.id}`
											const discordCopyValue =
												user.summary.discordUsername ?? user.summary.discordUserId ?? ''
											const characters = [...(user.details?.characters ?? [])].sort((a, b) => {
												if (a.is_primary !== b.is_primary) {
													return a.is_primary ? -1 : 1
												}
												return a.characterName.localeCompare(b.characterName)
											})

											return (
												<Card
													key={user.summary.id}
													className={cn(
														'border-border/70',
														user.summary.matchedCharacterId &&
															user.summary.matchedCharacterId !== user.summary.mainCharacterId &&
															'border-primary/30 bg-primary/5'
													)}
												>
													<CardContent className="space-y-4 pt-6">
														<div className="flex items-start gap-3">
															<img
																src={characterPortraitUrl(portraitId, 64)}
																alt={displayName}
																className="h-10 w-10 rounded-md"
															/>
															<div className="min-w-0 flex-1">
																<div className="flex flex-wrap items-center gap-2">
																	<p className="truncate text-base font-semibold">{displayName}</p>
																	{user.summary.is_admin && <Badge variant="default">Admin</Badge>}
																	{user.summary.discordUserId && (
																		<Badge variant="secondary">Discord linked</Badge>
																	)}
																</div>
																<div className="mt-2 flex flex-wrap gap-2">
																	<span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
																		<span className="text-white">
																			Character count: {user.summary.characterCount}
																		</span>
																	</span>
																	<CopyableMetaPill
																		label="User ID"
																		value={user.summary.id}
																		copied={copiedField === userIdCopy}
																		onCopy={() => copyToClipboard(user.summary.id, userIdCopy, 'User ID')}
																	/>
																	{discordCopyValue ? (
																		<CopyableMetaPill
																			label={user.summary.discordUsername ? 'Discord' : 'Discord ID'}
																			value={discordCopyValue}
																			copied={copiedField === `discord:${user.summary.id}`}
																			onCopy={() =>
																				copyToClipboard(
																					discordCopyValue,
																					`discord:${user.summary.id}`,
																					user.summary.discordUsername ? 'Discord username' : 'Discord ID'
																				)
																			}
																		/>
																	) : null}
																</div>
															</div>
														</div>

														<div className="space-y-2">
															<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
																<Users className="h-3.5 w-3.5" />
																Linked Characters
															</div>
															{characters.length > 0 ? (
																<div className="space-y-2">
																	{characters.map((character) => (
																		<div
																			key={character.characterId}
																			className={cn(
																				'rounded-lg border border-border/60 bg-background/80 px-3 py-2',
																				user.summary.matchedCharacterId === character.characterId &&
																					'border-primary/40 bg-primary/5'
																			)}
																		>
																			<CharacterIdentitySummary
																				characterId={character.characterId}
																				characterName={character.characterName}
																				hasAuthAccount
																				hasValidToken={character.hasValidToken}
																				corporationId={character.corporationId}
																				corporationName={character.corporationName}
																				allianceId={character.allianceId}
																				allianceName={character.allianceName}
																				portraitSize="sm"
																				showMetrics={false}
																				nameBadges={
																					<>
																						<Badge
																							variant={character.is_primary ? 'default' : 'secondary'}
																							className="px-1.5 py-0 text-[10px]"
																						>
																							{character.is_primary ? 'Main' : 'Alt'}
																						</Badge>
																					</>
																				}
																			/>
																		</div>
																	))}
																</div>
															) : (
																<p className="text-sm text-muted-foreground">
																	No linked characters were returned for this account.
																</p>
															)}
														</div>
													</CardContent>
												</Card>
											)
										})}
									</div>

									{hasPagination && (
										<div className="border-t border-border pt-4">
											<UserSearchPaginationControls
												totalCount={total}
												page={page}
												pageSize={pageSize}
												onPageChange={setPage}
												onPageSizeChange={(nextPageSize) => {
													setPageSize(nextPageSize)
													setPage(1)
												}}
												pageSizeOptions={[10, 25, 50]}
												itemLabel="users"
											/>
										</div>
									)}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			</DialogContent>
		</Dialog>
	)
}
