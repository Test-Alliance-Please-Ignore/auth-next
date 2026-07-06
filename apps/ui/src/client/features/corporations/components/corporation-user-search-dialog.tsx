import { Search, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { CopyableMetaPill } from '@/components/copyable-meta-pill'
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

export function CorporationUserSearchDialog({
	corporationId,
	open,
	onOpenChange,
}: CorporationUserSearchDialogProps) {
	const [searchQuery, setSearchQuery] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(10)
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
																	<span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
																		<span className="text-white">
																			{user.summary.characterCount} character
																			{user.summary.characterCount !== 1 ? 's' : ''}
																		</span>
																	</span>
																	{user.summary.is_admin && <Badge variant="default">Admin</Badge>}
																	{user.summary.discordUserId && (
																		<Badge variant="secondary">Discord linked</Badge>
																	)}
																</div>
																<div className="mt-2 flex flex-wrap gap-2">
																	<CopyableMetaPill
																		label="User ID"
																		value={user.summary.id}
																	/>
																	{user.summary.discordUsername ? (
																		<CopyableMetaPill
																			label="Discord username"
																			value={user.summary.discordUsername}
																		/>
																	) : null}
																	{user.summary.discordUserId ? (
																		<CopyableMetaPill
																			label="Discord ID"
																			value={user.summary.discordUserId}
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
