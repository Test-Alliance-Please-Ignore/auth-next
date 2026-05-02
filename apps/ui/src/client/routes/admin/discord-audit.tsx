import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useQueryClient } from '@tanstack/react-query'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingInline, LoadingSpinner } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
	useDiscordServers,
	discordKeys,
	useKickDiscordGuildUsers,
	useStartDiscordGuildAudit,
	useStripDiscordGuildRoles,
} from '@/hooks/useDiscord'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { api } from '@/lib/api'

type AuditTab = 'linked' | 'unlinked'
type AuditFilter =
	| 'all'
	| 'member_corp'
	| 'external'
	| 'roles_without_member_corp'
	| 'drifted'
	| 'with_roles'
	| 'without_roles'

const SESSION_CACHE_KEY = 'discord-member-audit-cache-v1'

function formatDiscordHandle(username: string, discriminator: string): string {
	if (!discriminator || discriminator === '0') return username
	return `${username}#${discriminator}`
}

export default function AdminDiscordAuditPage() {
	const { data: servers = [], isLoading: serversLoading } = useDiscordServers()
	const [serverId, setServerId] = useState<string>('')
	const [activeServerId, setActiveServerId] = useState<string>('')
	const [tab, setTab] = useState<AuditTab>('linked')
	const [filter, setFilter] = useState<AuditFilter>('all')
	const [page, setPage] = useState<number>(1)
	const [pageSize, setPageSize] = useState<number>(25)
	const [data, setData] = useState<Awaited<ReturnType<typeof api.getDiscordGuildAudit>> | null>(null)
	const [isLoading, setIsLoading] = useState<boolean>(false)
	const [selectedUnlinked, setSelectedUnlinked] = useState<Record<string, boolean>>({})

	const { requestConfirmation, closeConfirmation, confirmationDialog } = useConfirmationDialog()
	const queryClient = useQueryClient()
	const stripRoles = useStripDiscordGuildRoles()
	const kickUsers = useKickDiscordGuildUsers()
	const startAuditMutation = useStartDiscordGuildAudit()

	const effectiveServerId = activeServerId
	const isFetching = isLoading
	const runStatus = data?.runStatus
	const isRunActive = runStatus === 'pending' || runStatus === 'processing'
	const [nowMs, setNowMs] = useState<number>(Date.now())
	const [startCooldownUntil, setStartCooldownUntil] = useState<number>(0)
	const startCooldownRemainingMs = Math.max(0, startCooldownUntil - nowMs)
	const isStartCooldownActive = startCooldownRemainingMs > 0

	const selectedIds = useMemo(
		() => Object.entries(selectedUnlinked).filter(([, checked]) => checked).map(([id]) => id),
		[selectedUnlinked]
	)

	const unlinkedRows = (data?.items ?? []).filter((item) => !item.linked)
	const allVisibleUnlinkedChecked =
		unlinkedRows.length > 0 && unlinkedRows.every((row) => selectedUnlinked[row.discordUserId] === true)

	useEffect(() => {
		try {
			const raw = sessionStorage.getItem(SESSION_CACHE_KEY)
			if (!raw) return
			const parsed = JSON.parse(raw) as {
				serverId?: string
				activeServerId?: string
				tab?: AuditTab
				filter?: AuditFilter
				page?: number
				pageSize?: number
			}
			if (parsed.serverId) setServerId(parsed.serverId)
			if (parsed.activeServerId) setActiveServerId(parsed.activeServerId)
			if (parsed.tab) setTab(parsed.tab)
			if (parsed.filter) setFilter(parsed.filter)
			if (typeof parsed.page === 'number') setPage(parsed.page)
			if (typeof parsed.pageSize === 'number') setPageSize(parsed.pageSize)
		} catch {
			// ignore malformed cache
		}
	}, [])

	useEffect(() => {
		const cachePayload = {
			serverId,
			activeServerId,
			tab,
			filter,
			page,
			pageSize,
		}
		sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(cachePayload))
	}, [activeServerId, filter, page, pageSize, serverId, tab])

	const fetchAuditPage = async (
		server: string,
		fetchTab: AuditTab,
		pageOverride = page,
		filterOverride?: AuditFilter,
		pageSizeOverride = pageSize
	) => {
		setIsLoading(true)
		try {
			const response = await api.getDiscordGuildAudit(server, {
				tab: fetchTab,
				filter: filterOverride ?? filter,
				page: pageOverride,
				pageSize: pageSizeOverride,
			})
			setData(response)
		} finally {
			setIsLoading(false)
		}
	}

	useEffect(() => {
		if (!isStartCooldownActive) return
		const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
		return () => window.clearInterval(timer)
	}, [isStartCooldownActive])

	useEffect(() => {
		if (!effectiveServerId) return
		if (runStatus !== 'pending' && runStatus !== 'processing') return
		const timer = window.setInterval(() => {
			void fetchAuditPage(effectiveServerId, tab)
		}, 5000)
		return () => window.clearInterval(timer)
	}, [effectiveServerId, filter, page, pageSize, runStatus, tab])

	useEffect(() => {
		if (!effectiveServerId) return
		if (isLoading) return
		if (data && data.tab === tab && data.filter === filter && data.pagination?.page === page && data.pagination?.pageSize === pageSize) {
			return
		}
		void fetchAuditPage(effectiveServerId, tab)
	}, [data, effectiveServerId, filter, isLoading, page, pageSize, tab])

	const onChangeServer = (value: string) => {
		setServerId(value)
		setActiveServerId('')
		setData(null)
		setPage(1)
		setSelectedUnlinked({})
	}

	const startAudit = () => {
		if (!serverId) return
		if (isRunActive || isStartCooldownActive) return
		setActiveServerId(serverId)
		setSelectedUnlinked({})
		setPage(1)
		setData(null)
		setStartCooldownUntil(Date.now() + 60_000)
		void (async () => {
			await startAuditMutation.mutateAsync(serverId)
			await fetchAuditPage(serverId, tab, 1)
		})()
	}

	const onChangeTab = (value: string) => {
		const nextTab = value as AuditTab
		setTab(nextTab)
		setFilter('all')
		setPage(1)
		setSelectedUnlinked({})
		if (effectiveServerId) {
			void fetchAuditPage(effectiveServerId, nextTab, 1, 'all')
		}
	}

	const onChangeFilter = (value: string) => {
		const nextFilter = value as AuditFilter
		setFilter(nextFilter)
		setPage(1)
		if (!effectiveServerId) return
		void fetchAuditPage(effectiveServerId, tab, 1, nextFilter)
	}

	const toggleAllVisibleUnlinked = (checked: boolean) => {
		setSelectedUnlinked((prev) => {
			const next = { ...prev }
			for (const row of unlinkedRows) {
				next[row.discordUserId] = checked
			}
			return next
		})
	}

	const stripSingleUserRoles = async (discordUserId: string) => {
		requestConfirmation({
			title: 'Strip all roles for this Discord user?',
			description:
				'This will clear all assignable roles in this guild for the selected user. This cannot be undone.',
			confirmLabel: 'Strip Roles',
			cancelLabel: 'Cancel',
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await stripRoles.mutateAsync({ serverId: effectiveServerId, discordUserIds: [discordUserId] })
					await queryClient.invalidateQueries({
						queryKey: [...discordKeys.all, 'audit', effectiveServerId],
						refetchType: 'all',
					})
					setSelectedUnlinked((prev) => ({ ...prev, [discordUserId]: false }))
					void fetchAuditPage(effectiveServerId, tab)
				} finally {
					closeConfirmation()
				}
			},
		})
	}

	const stripSelectedRoles = async () => {
		if (selectedIds.length === 0) return

		requestConfirmation({
			title: `Strip roles for ${selectedIds.length} users?`,
			description:
				'This will clear all assignable roles in this guild for the selected users. This cannot be undone.',
			confirmLabel: 'Strip Roles',
			cancelLabel: 'Cancel',
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await stripRoles.mutateAsync({
						serverId: effectiveServerId,
						discordUserIds: selectedIds,
					})
					await queryClient.invalidateQueries({
						queryKey: [...discordKeys.all, 'audit', effectiveServerId],
						refetchType: 'all',
					})
					setSelectedUnlinked({})
					void fetchAuditPage(effectiveServerId, tab)
				} finally {
					closeConfirmation()
				}
			},
		})
	}

	const kickSingleUser = async (discordUserId: string) => {
		requestConfirmation({
			title: 'Kick this Discord user from the server?',
			description:
				'This removes the selected user from the Discord server. They can rejoin later if invited again.',
			confirmLabel: 'Kick User',
			cancelLabel: 'Cancel',
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await kickUsers.mutateAsync({ serverId: effectiveServerId, discordUserIds: [discordUserId] })
					setSelectedUnlinked((prev) => ({ ...prev, [discordUserId]: false }))
					void fetchAuditPage(effectiveServerId, tab)
				} finally {
					closeConfirmation()
				}
			},
		})
	}

	const refreshLinkedUser = async (coreUserId: string) => {
		await api.triggerDiscordJoin(coreUserId)
		void fetchAuditPage(effectiveServerId, tab)
	}

	const totalCount = data?.pagination?.totalCount ?? 0

	const renderPaginationControls = (position: 'top' | 'bottom') => (
		<div className={position === 'bottom' ? 'border-t border-border pt-4' : ''}>
			<UserSearchPaginationControls
				totalCount={totalCount}
				page={page}
				pageSize={pageSize}
				pageSizeOptions={[10, 25, 50, 100]}
				onPageChange={(nextPage) => {
					setPage(nextPage)
					if (effectiveServerId) {
						void fetchAuditPage(effectiveServerId, tab, nextPage)
					}
				}}
				onPageSizeChange={(nextPageSize) => {
					setPageSize(nextPageSize)
					setPage(1)
					if (effectiveServerId) {
						void fetchAuditPage(effectiveServerId, tab, 1, undefined, nextPageSize)
					}
				}}
			/>
		</div>
	)

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<div>
						<CardTitle>Discord Member Audit</CardTitle>
						<CardDescription>
							Audit guild members against linked platform users. Linked users can be inspected/refreshed;
							unlinked users can have roles stripped.
						</CardDescription>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-4 md:grid-cols-[minmax(18rem,28rem)_1fr]">
						<Select
							value={serverId}
							onValueChange={onChangeServer}
							options={servers.map((server) => ({
								value: server.id,
								label: `${server.guildName} (${server.guildId})`,
							}))}
							placeholder={serversLoading ? 'Loading servers...' : 'Select a server'}
							className="w-full"
						/>
						<div className="flex items-center justify-end gap-2">
							<Button
								variant="primary"
								onClick={startAudit}
								disabled={
									!serverId ||
									isFetching ||
									startAuditMutation.isPending ||
									isRunActive ||
									isStartCooldownActive
								}
							>
								{isFetching || startAuditMutation.isPending ? <LoadingInline className="mr-2" /> : null}
								{isRunActive
									? 'Audit Running'
									: isStartCooldownActive
										? `Start Audit (${Math.ceil(startCooldownRemainingMs / 1000)}s)`
										: 'Start Audit'}
							</Button>
							<Button
								variant="secondary"
								onClick={() => void fetchAuditPage(effectiveServerId, tab)}
								disabled={!effectiveServerId || isFetching}
							>
								{isFetching ? <LoadingInline className="mr-2" /> : null}
								Refresh
							</Button>
						</div>
					</div>

					<Tabs value={tab} onValueChange={onChangeTab}>
						<TabsList>
							<TabsTrigger value="linked">Linked</TabsTrigger>
							<TabsTrigger value="unlinked">Unlinked</TabsTrigger>
						</TabsList>
					</Tabs>
					<div className="max-w-sm">
						<Select
							value={filter}
							onValueChange={onChangeFilter}
							options={
								tab === 'linked'
									? [
											{ value: 'all', label: 'All Rows' },
											{ value: 'drifted', label: 'Drifted (Unmanaged Roles)' },
											{ value: 'roles_without_member_corp', label: 'Roles w/o Member Corp' },
											{ value: 'member_corp', label: 'Member Corp Only' },
											{ value: 'external', label: 'External Only' },
										]
									: [
											{ value: 'all', label: 'All Rows' },
											{ value: 'with_roles', label: 'With Roles Only' },
											{ value: 'without_roles', label: 'Without Roles Only' },
										]
							}
							placeholder="Filter"
						/>
					</div>

					{tab === 'unlinked' && (
						<div className="flex items-center justify-between gap-2 rounded-md border p-3">
							<div className="text-sm text-muted-foreground">
								{selectedIds.length} selected for bulk strip.
							</div>
							<Button
								variant="destructive"
								onClick={() => void stripSelectedRoles()}
								disabled={selectedIds.length === 0 || stripRoles.isPending}
							>
								Strip Roles (Selected)
							</Button>
						</div>
					)}

					{effectiveServerId && isLoading ? (
						<div className="rounded-md border px-3 py-2">
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<LoadingInline />
								Audit ingest in progress. Fetching guild members...
							</div>
						</div>
					) : null}
					{effectiveServerId && data?.runStatus ? (
						<div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
							Run status: <span className="font-medium text-foreground">{data.runStatus}</span>
							{typeof data.scanned === 'number' ? ` · Scanned ${data.scanned}` : ''}
							{data.runError ? ` · ${data.runError}` : ''}
						</div>
					) : null}

					<div className="rounded-md border">
						<div className="p-3">{renderPaginationControls('top')}</div>
						{!effectiveServerId && !serversLoading ? (
							<div className="py-10 text-center text-sm text-muted-foreground">
								Select a configured Discord server, then click Start Audit.
							</div>
						) : (
						<Table>
							<TableHeader>
								<TableRow>
									{tab === 'unlinked' && (
										<TableHead className="w-10">
											<Checkbox
												checked={allVisibleUnlinkedChecked}
												onCheckedChange={(checked) => toggleAllVisibleUnlinked(checked === true)}
											/>
										</TableHead>
									)}
									<TableHead>Discord User</TableHead>
									{tab === 'linked' && <TableHead>Corporation</TableHead>}
									{tab === 'linked' && <TableHead>Affiliation</TableHead>}
									<TableHead>Link</TableHead>
									{tab === 'linked' && <TableHead>Token</TableHead>}
									<TableHead>Roles</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{isLoading ? (
									<TableRow>
										<TableCell
											colSpan={tab === 'linked' ? 8 : 6}
											className="py-8 text-center text-muted-foreground"
										>
											<LoadingSpinner size="sm" label="Loading audit members..." className="py-2" />
										</TableCell>
									</TableRow>
								) : (data?.items?.length ?? 0) === 0 ? (
									<TableRow>
										<TableCell
											colSpan={tab === 'linked' ? 8 : 6}
											className="py-8 text-center text-muted-foreground"
										>
											No {tab} users found on this page.
										</TableCell>
									</TableRow>
								) : (
									data!.items.map((item) => (
										<TableRow key={item.discordUserId}>
											{tab === 'unlinked' && (
												<TableCell>
													<Checkbox
														checked={selectedUnlinked[item.discordUserId] === true}
														onCheckedChange={(checked) =>
															setSelectedUnlinked((prev) => ({
																...prev,
																[item.discordUserId]: checked === true,
															}))
														}
													/>
												</TableCell>
											)}
											<TableCell>
												{item.linked && item.coreUserId ? (
													<Link
														to={`/admin/users/${item.coreUserId}`}
														target="_blank"
														rel="noreferrer"
														className="block hover:underline"
													>
														<div className="font-medium">{item.displayName}</div>
														<div className="text-xs text-muted-foreground">
															{formatDiscordHandle(item.username, item.discriminator)} · {item.discordUserId}
														</div>
													</Link>
												) : (
													<>
														<div className="font-medium">{item.displayName}</div>
														<div className="text-xs text-muted-foreground">
															{formatDiscordHandle(item.username, item.discriminator)} · {item.discordUserId}
														</div>
													</>
												)}
											</TableCell>
											{tab === 'linked' && (
												<TableCell>
													{item.corporationName ? (
														<div className="text-sm">{item.corporationName}</div>
													) : (
														<span className="text-xs text-muted-foreground">Unknown</span>
													)}
													{item.corporationId && (
														<div className="text-xs text-muted-foreground">{item.corporationId}</div>
													)}
												</TableCell>
											)}
											{tab === 'linked' && (
												<TableCell>
													{item.isInMemberCorporation ? (
														<Badge variant="success">Member Corp</Badge>
													) : (
														<Badge variant="warning">External</Badge>
													)}
												</TableCell>
											)}
											<TableCell>
												{item.linked && item.coreUserId ? (
													<Badge variant="secondary">Linked</Badge>
												) : (
													<Badge variant="destructive">Unlinked</Badge>
												)}
											</TableCell>
											{tab === 'linked' && (
												<TableCell>
													{item.hasValidToken === true ? (
														<Badge variant="success">Valid</Badge>
													) : item.hasValidToken === false ? (
														<Badge variant="destructive">Invalid</Badge>
													) : (
														<Badge variant="warning">Unknown</Badge>
													)}
												</TableCell>
											)}
											<TableCell>
												<div className="text-xs text-muted-foreground space-y-1">
													{item.roleIds.length} roles assigned
													{item.hasRoleAffiliationMismatch ? (
														<div>
															<Badge variant="destructive">
																Roles w/o Member Corp
																{(item.unmanagedRoleCount ?? 0) > 0
																	? ` (${item.unmanagedRoleCount} unmanaged)`
																	: ''}
															</Badge>
														</div>
													) : null}
												</div>
											</TableCell>
											<TableCell className="text-right">
												{item.linked && item.coreUserId ? (
													<div className="inline-flex items-center gap-2">
														<Button variant="secondary" size="sm" asChild>
															<Link to={`/admin/users/${item.coreUserId}/discord-access`}>Inspect</Link>
														</Button>
														<Button
															variant="secondary"
															size="sm"
															onClick={() => void refreshLinkedUser(item.coreUserId!)}
														>
															Refresh
														</Button>
														<Button
															variant="destructive"
															size="sm"
															onClick={() => void stripSingleUserRoles(item.discordUserId)}
														>
															Strip Roles
														</Button>
													</div>
													) : (
														<div className="inline-flex items-center gap-2">
															<Button
																variant="destructive"
																size="sm"
																onClick={() => void stripSingleUserRoles(item.discordUserId)}
															>
																Strip Roles
															</Button>
															<Button
																variant="destructive"
																size="sm"
																onClick={() => void kickSingleUser(item.discordUserId)}
															>
																Kick User
															</Button>
														</div>
													)}
												</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
						)}
					</div>
					{renderPaginationControls('bottom')}
				</CardContent>
			</Card>
			{confirmationDialog}
		</div>
	)
}
