import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingInline, LoadingSpinner } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDiscordServers, useStartDiscordGuildAudit, useStripDiscordGuildRoles } from '@/hooks/useDiscord'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type AuditTab = 'linked' | 'unlinked'
type CursorValue = string | null

type AuditPageState = {
	pages: Record<string, Awaited<ReturnType<typeof api.getDiscordGuildAudit>>>
	currentCursor: CursorValue
	cursorStack: string[]
	nextCursorByCursor: Record<string, string | null>
	isLoading: boolean
	isLoaded: boolean
}

type ServerAuditState = Record<AuditTab, AuditPageState>

const SESSION_CACHE_KEY = 'discord-member-audit-cache-v1'

function cursorKey(cursor: CursorValue): string {
	return cursor ?? '__root__'
}

function createEmptyPageState(): AuditPageState {
	return {
		pages: {},
		currentCursor: null,
		cursorStack: [],
		nextCursorByCursor: {},
		isLoading: false,
		isLoaded: false,
	}
}

function createEmptyServerState(): ServerAuditState {
	return {
		linked: createEmptyPageState(),
		unlinked: createEmptyPageState(),
	}
}

function formatDiscordHandle(username: string, discriminator: string): string {
	if (!discriminator || discriminator === '0') return username
	return `${username}#${discriminator}`
}

export default function AdminDiscordAuditPage() {
	const { data: servers = [], isLoading: serversLoading } = useDiscordServers()
	const [serverId, setServerId] = useState<string>('')
	const [activeServerId, setActiveServerId] = useState<string>('')
	const [tab, setTab] = useState<AuditTab>('linked')
	const [auditByServer, setAuditByServer] = useState<Record<string, ServerAuditState>>({})
	const [selectedUnlinked, setSelectedUnlinked] = useState<Record<string, boolean>>({})
	const [rowStatus, setRowStatus] = useState<Record<string, string>>({})

	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const stripRoles = useStripDiscordGuildRoles()
	const startAuditMutation = useStartDiscordGuildAudit()

	const effectiveServerId = activeServerId
	const tabState =
		(effectiveServerId ? auditByServer[effectiveServerId]?.[tab] : undefined) ?? createEmptyPageState()
	const currentCursor = tabState.currentCursor
	const data = tabState.pages[cursorKey(currentCursor)] ?? null
	const isLoading = tabState.isLoading
	const isFetching = tabState.isLoading
	const nextCursor = tabState.nextCursorByCursor[cursorKey(currentCursor)] ?? data?.nextCursor ?? null
	const runStatus = data?.runStatus
	const pageNumber = tabState.cursorStack.length + 1
	const pageCountLabel = data?.nextCursor ? `${pageNumber}+` : `${pageNumber}`

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
				auditByServer?: Record<string, ServerAuditState>
			}
			if (parsed.serverId) setServerId(parsed.serverId)
			if (parsed.activeServerId) setActiveServerId(parsed.activeServerId)
			if (parsed.tab) setTab(parsed.tab)
			if (parsed.auditByServer) setAuditByServer(parsed.auditByServer)
		} catch {
			// ignore malformed cache
		}
	}, [])

	useEffect(() => {
		const cachePayload = {
			serverId,
			activeServerId,
			tab,
			auditByServer,
		}
		sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(cachePayload))
	}, [activeServerId, auditByServer, serverId, tab])

	const fetchAuditPage = async (server: string, fetchTab: AuditTab, cursor: CursorValue) => {
		setAuditByServer((prev) => {
			const serverState = prev[server] ?? createEmptyServerState()
			return {
				...prev,
				[server]: {
					...serverState,
					[fetchTab]: {
						...serverState[fetchTab],
						isLoading: true,
					},
				},
			}
		})

		const response = await api.getDiscordGuildAudit(server, {
			tab: fetchTab,
			cursor,
			limit: 50,
		})

		setAuditByServer((prev) => {
			const serverState = prev[server] ?? createEmptyServerState()
			const existingTabState = serverState[fetchTab]
			return {
				...prev,
				[server]: {
					...serverState,
					[fetchTab]: {
						...existingTabState,
						pages: {
							...existingTabState.pages,
							[cursorKey(cursor)]: response,
						},
						nextCursorByCursor: {
							...existingTabState.nextCursorByCursor,
							[cursorKey(cursor)]: response.nextCursor,
						},
						isLoading: false,
						isLoaded: true,
					},
				},
			}
		})
	}

	useEffect(() => {
		if (!effectiveServerId) return
		if (runStatus !== 'pending' && runStatus !== 'processing') return
		const timer = window.setInterval(() => {
			void fetchAuditPage(effectiveServerId, tab, currentCursor)
		}, 5000)
		return () => window.clearInterval(timer)
	}, [currentCursor, effectiveServerId, runStatus, tab])

	const onChangeServer = (value: string) => {
		setServerId(value)
		setActiveServerId('')
		setSelectedUnlinked({})
		setRowStatus({})
	}

	const startAudit = () => {
		if (!serverId) return
		setActiveServerId(serverId)
		setSelectedUnlinked({})
		setRowStatus({})
		void (async () => {
			await startAuditMutation.mutateAsync(serverId)
			setAuditByServer((prev) => ({
				...prev,
				[serverId]: createEmptyServerState(),
			}))
			await fetchAuditPage(serverId, tab, null)
		})()
	}

	const onChangeTab = (value: string) => {
		const nextTab = value as AuditTab
		setTab(nextTab)
		setSelectedUnlinked({})
		setRowStatus({})
		if (effectiveServerId) {
			const nextState = auditByServer[effectiveServerId]?.[nextTab]
			if (!nextState?.isLoaded) {
				void fetchAuditPage(effectiveServerId, nextTab, null)
			}
		}
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
				await stripRoles.mutateAsync({ serverId: effectiveServerId, discordUserIds: [discordUserId] })
				setSelectedUnlinked((prev) => ({ ...prev, [discordUserId]: false }))
				void fetchAuditPage(effectiveServerId, tab, currentCursor)
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
				await stripRoles.mutateAsync({
					serverId: effectiveServerId,
					discordUserIds: selectedIds,
				})
				setSelectedUnlinked({})
				void fetchAuditPage(effectiveServerId, tab, currentCursor)
			},
		})
	}

	const inspectLinkedUser = async (coreUserId: string) => {
		const inspection = await api.inspectDiscordAccess(coreUserId)
		const guild = inspection.guilds.find((g) => g.guildId === data?.server.guildId)
		if (!guild) {
			setRowStatus((prev) => ({ ...prev, [coreUserId]: 'Inspection: guild not found' }))
			return
		}
		const hasDrift =
			guild.missingExpectedManagedRoles.length > 0 || guild.unexpectedManagedRoles.length > 0
		setRowStatus((prev) => ({
			...prev,
			[coreUserId]: hasDrift
				? `Inspection drift (${guild.missingExpectedManagedRoles.length} missing / ${guild.unexpectedManagedRoles.length} unexpected)`
				: 'Inspection OK',
		}))
	}

	const refreshLinkedUser = async (coreUserId: string) => {
		await api.triggerDiscordJoin(coreUserId)
		setRowStatus((prev) => ({ ...prev, [coreUserId]: 'Refresh triggered' }))
		void fetchAuditPage(effectiveServerId, tab, currentCursor)
	}

	const goToPreviousPage = () => {
		const currentTabState = auditByServer[effectiveServerId]?.[tab]
		if (!currentTabState || currentTabState.cursorStack.length === 0) return
		const nextStack = [...currentTabState.cursorStack]
		const previousCursor = nextStack.pop() ?? null
		setAuditByServer((prev) => {
			const serverState = prev[effectiveServerId]
			if (!serverState) return prev
			return {
				...prev,
				[effectiveServerId]: {
					...serverState,
					[tab]: {
						...serverState[tab],
						cursorStack: nextStack,
						currentCursor: previousCursor,
					},
				},
			}
		})
	}

	const goToNextPage = () => {
		if (!effectiveServerId || !nextCursor) return
		setAuditByServer((prev) => {
			const serverState = prev[effectiveServerId] ?? createEmptyServerState()
			const existingTab = serverState[tab]
			return {
				...prev,
				[effectiveServerId]: {
					...serverState,
					[tab]: {
						...existingTab,
						cursorStack: [...existingTab.cursorStack, existingTab.currentCursor ?? ''],
						currentCursor: nextCursor,
					},
				},
			}
		})
		const nextKey = cursorKey(nextCursor)
		const hasPage = auditByServer[effectiveServerId]?.[tab]?.pages[nextKey] !== undefined
		if (!hasPage) {
			void fetchAuditPage(effectiveServerId, tab, nextCursor)
		}
	}

	const renderPaginationControls = (position: 'top' | 'bottom') => (
		<div
			className={cn(
				'flex flex-col gap-3 md:flex-row md:items-center md:justify-between',
				position === 'bottom' ? 'border-t border-border pt-4' : ''
			)}
		>
			<div className="text-sm text-muted-foreground">
				Page {pageNumber} of {pageCountLabel}
				{typeof data?.scanned === 'number' ? ` · Scanned ${data.scanned}` : ''}
			</div>
			<div className="flex items-center justify-end gap-2">
				<Button variant="secondary" onClick={goToPreviousPage} disabled={!effectiveServerId || tabState.cursorStack.length === 0}>
					Previous
				</Button>
				<Button variant="secondary" onClick={goToNextPage} disabled={!effectiveServerId || !nextCursor}>
					Next
				</Button>
			</div>
		</div>
	)

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<div className="space-y-4">
						<div>
							<CardTitle>Discord Member Audit</CardTitle>
							<CardDescription>
								Audit guild members against linked platform users. Linked users can be inspected/refreshed;
								unlinked users can have roles stripped.
							</CardDescription>
						</div>
						{renderPaginationControls('top')}
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
								disabled={!serverId || isFetching || startAuditMutation.isPending}
							>
								{isFetching || startAuditMutation.isPending ? <LoadingInline className="mr-2" /> : null}
								Start Audit
							</Button>
							<Button
								variant="secondary"
								onClick={() => void fetchAuditPage(effectiveServerId, tab, currentCursor)}
								disabled={!effectiveServerId || isFetching}
							>
								{isFetching ? <LoadingInline className="mr-2" /> : null}
								Refresh
							</Button>
							<Button
								variant="secondary"
								onClick={goToPreviousPage}
								disabled={!effectiveServerId || tabState.cursorStack.length === 0}
							>
								Previous Page
							</Button>
							<Button
								variant="secondary"
								onClick={goToNextPage}
								disabled={!effectiveServerId || !nextCursor}
							>
								Next Page
							</Button>
						</div>
					</div>

					<Tabs value={tab} onValueChange={onChangeTab}>
						<TabsList>
							<TabsTrigger value="linked">Linked</TabsTrigger>
							<TabsTrigger value="unlinked">Unlinked</TabsTrigger>
						</TabsList>
					</Tabs>

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
									<TableHead>Link</TableHead>
									{tab === 'linked' && <TableHead>Token</TableHead>}
									{tab === 'linked' && <TableHead>Corporation</TableHead>}
									{tab === 'linked' && <TableHead>Affiliation</TableHead>}
									<TableHead>Roles</TableHead>
									{tab === 'linked' && <TableHead>Managed Role State</TableHead>}
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
												<div className="font-medium">{item.displayName}</div>
												<div className="text-xs text-muted-foreground">
													{formatDiscordHandle(item.username, item.discriminator)} · {item.discordUserId}
												</div>
											</TableCell>
											<TableCell>
												{item.linked && item.coreUserId ? (
													<div className="space-y-1">
														<Badge variant="secondary">Linked</Badge>
														<div className="text-xs text-muted-foreground">
															<Link to={`/admin/users/${item.coreUserId}`} className="hover:underline">
																{item.mainCharacterName ?? item.coreUserId}
															</Link>
														</div>
													</div>
												) : (
													<Badge variant="destructive">Unlinked</Badge>
												)}
											</TableCell>
											{tab === 'linked' && (
												<TableCell>
													{item.hasValidToken === true ? (
														<Badge className="text-emerald-400 border-emerald-400/40" variant="secondary">
															Valid
														</Badge>
													) : item.hasValidToken === false ? (
														<Badge className="text-red-400 border-red-400/40" variant="secondary">
															Invalid
														</Badge>
													) : (
														<Badge className="text-amber-400 border-amber-400/40" variant="secondary">
															Unknown
														</Badge>
													)}
												</TableCell>
											)}
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
													{item.hasRoleAffiliationMismatch ? (
														<Badge variant="destructive">
															Roles w/o Member Corp
															{(item.unmanagedRoleCount ?? 0) > 0
																? ` (${item.unmanagedRoleCount} unmanaged)`
																: ''}
														</Badge>
													) : item.isInMemberCorporation ? (
														<Badge variant="success">Member Corp</Badge>
													) : (
														<Badge variant="warning">External</Badge>
													)}
												</TableCell>
											)}
											<TableCell>
												<div className="text-xs text-muted-foreground">
													{item.roleIds.length} roles assigned
												</div>
											</TableCell>
											{tab === 'linked' && (
												<TableCell>
													{item.roleState ? (
														<Badge
															variant="secondary"
															className={cn(
																item.roleState === 'ok' && 'text-emerald-400 border-emerald-400/40',
																item.roleState === 'drift' && 'text-amber-400 border-amber-400/40',
																item.roleState === 'error' && 'text-red-400 border-red-400/40'
															)}
														>
															{item.roleState}
														</Badge>
													) : (
														<span className="text-xs text-muted-foreground">Unknown</span>
													)}
													{item.roleStateReason && (
														<div className="mt-1 text-xs text-muted-foreground">{item.roleStateReason}</div>
													)}
													{item.coreUserId && rowStatus[item.coreUserId] && (
														<div className="mt-1 text-xs text-muted-foreground">{rowStatus[item.coreUserId]}</div>
													)}
												</TableCell>
											)}
											<TableCell className="text-right">
												{item.linked && item.coreUserId ? (
													<div className="inline-flex items-center gap-2">
														<Button
															variant="secondary"
															size="sm"
															onClick={() => void inspectLinkedUser(item.coreUserId!)}
														>
															Inspect
														</Button>
														<Button
															variant="secondary"
															size="sm"
															onClick={() => void refreshLinkedUser(item.coreUserId!)}
														>
															Refresh
														</Button>
													</div>
												) : (
													<Button
														variant="destructive"
														size="sm"
														onClick={() => void stripSingleUserRoles(item.discordUserId)}
													>
														Strip Roles
													</Button>
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
