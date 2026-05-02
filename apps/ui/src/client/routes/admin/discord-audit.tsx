import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDiscordGuildAudit, useDiscordServers, useStripDiscordGuildRoles } from '@/hooks/useDiscord'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type AuditTab = 'linked' | 'unlinked'

export default function AdminDiscordAuditPage() {
	const { data: servers = [], isLoading: serversLoading } = useDiscordServers()
	const [serverId, setServerId] = useState<string>('')
	const [tab, setTab] = useState<AuditTab>('linked')
	const [cursor, setCursor] = useState<string | null>(null)
	const [cursorStack, setCursorStack] = useState<string[]>([])
	const [selectedUnlinked, setSelectedUnlinked] = useState<Record<string, boolean>>({})
	const [rowStatus, setRowStatus] = useState<Record<string, string>>({})

	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const stripRoles = useStripDiscordGuildRoles()

	const effectiveServerId = serverId
	const { data, isLoading, refetch, isFetching } = useDiscordGuildAudit(effectiveServerId, {
		tab,
		cursor,
		limit: 50,
	})

	const selectedIds = useMemo(
		() => Object.entries(selectedUnlinked).filter(([, checked]) => checked).map(([id]) => id),
		[selectedUnlinked]
	)

	const unlinkedRows = (data?.items ?? []).filter((item) => !item.linked)
	const allVisibleUnlinkedChecked =
		unlinkedRows.length > 0 && unlinkedRows.every((row) => selectedUnlinked[row.discordUserId] === true)

	const onChangeServer = (value: string) => {
		setServerId(value)
		setCursor(null)
		setCursorStack([])
		setSelectedUnlinked({})
		setRowStatus({})
	}

	const onChangeTab = (value: string) => {
		const nextTab = value as AuditTab
		setTab(nextTab)
		setCursor(null)
		setCursorStack([])
		setSelectedUnlinked({})
		setRowStatus({})
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
				void refetch()
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
				void refetch()
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
		void refetch()
	}

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Discord Guild Audit</CardTitle>
					<CardDescription>
						Audit guild members against linked platform users. Linked users can be inspected/refreshed;
						unlinked users can have roles stripped.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-4 md:grid-cols-[minmax(18rem,28rem)_1fr]">
						<Select
							value={effectiveServerId}
							onValueChange={onChangeServer}
							options={servers.map((server) => ({
								value: server.id,
								label: `${server.guildName} (${server.guildId})`,
							}))}
							placeholder={serversLoading ? 'Loading servers...' : 'Select a server'}
							className="w-full"
						/>
						<div className="flex items-center justify-end gap-2">
							<Button variant="secondary" onClick={() => void refetch()} disabled={!effectiveServerId || isFetching}>
								Refresh
							</Button>
							<Button
								variant="secondary"
								onClick={() => {
									if (cursorStack.length === 0) return
									const nextStack = [...cursorStack]
									const previousCursor = nextStack.pop() ?? null
									setCursorStack(nextStack)
									setCursor(previousCursor)
								}}
								disabled={cursorStack.length === 0}
							>
								Previous Page
							</Button>
							<Button
								variant="secondary"
								onClick={() => {
									if (!data?.nextCursor) return
									setCursorStack((prev) => [...prev, cursor ?? ''])
									setCursor(data.nextCursor)
								}}
								disabled={!data?.nextCursor}
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

					<div className="rounded-md border">
						{!effectiveServerId && !serversLoading ? (
							<div className="py-10 text-center text-sm text-muted-foreground">
								Select a configured Discord server to start a member audit.
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
									<TableHead>Roles</TableHead>
									{tab === 'linked' && <TableHead>Managed Role State</TableHead>}
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{isLoading ? (
									<TableRow>
										<TableCell
											colSpan={tab === 'linked' ? 7 : 6}
											className="py-8 text-center text-muted-foreground"
										>
											Loading audit members...
										</TableCell>
									</TableRow>
								) : (data?.items?.length ?? 0) === 0 ? (
									<TableRow>
										<TableCell
											colSpan={tab === 'linked' ? 7 : 6}
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
													@{item.username}#{item.discriminator} · {item.discordUserId}
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
				</CardContent>
			</Card>
			{confirmationDialog}
		</div>
	)
}
