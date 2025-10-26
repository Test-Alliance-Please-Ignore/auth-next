import { formatDistanceToNow } from 'date-fns'
import {
	ArrowLeft,
	Building2,
	CheckCircle2,
	Database,
	MessageSquare,
	Package,
	Plus,
	RefreshCw,
	Save,
	Settings,
	Shield,
	ShieldAlert,
	ShieldCheck,
	Skull,
	Trash2,
	TrendingUp,
	Users,
	Wallet,
	X,
	XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { DirectorList } from '@/components/DirectorList'
import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/ui/confirm-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBreadcrumb } from '@/hooks/useBreadcrumb'
import {
	useCorporation,
	useCorporationDataSummary,
	useFetchCorporationData,
	useUpdateCorporation,
	useVerifyCorporationAccess,
} from '@/hooks/useCorporations'
import {
	useAssignRoleToCorporationServer,
	useAttachDiscordServer,
	useCorporationDiscordServers,
	useDetachDiscordServer,
	useDiscordServers,
	useUnassignRoleFromCorporationServer,
	useUpdateCorporationDiscordServer,
} from '@/hooks/useDiscord'
import { useMessage } from '@/hooks/useMessage'

import type { UpdateCorporationRequest } from '@/lib/api'

export default function CorporationDetailPage() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const corpId = corporationId || ''

	const { data: corporation, isLoading } = useCorporation(corpId)
	const { data: dataSummary, isLoading: summaryLoading } = useCorporationDataSummary(corpId)
	const updateCorporation = useUpdateCorporation()
	const verifyAccess = useVerifyCorporationAccess()
	const fetchData = useFetchCorporationData()

	// Discord hooks
	const { data: discordServers = [] } = useDiscordServers()
	const { data: corporationDiscordServers = [] } = useCorporationDiscordServers(corpId)
	const attachServer = useAttachDiscordServer()
	const detachServer = useDetachDiscordServer()
	const updateAttachment = useUpdateCorporationDiscordServer()
	const assignRole = useAssignRoleToCorporationServer()
	const unassignRole = useUnassignRoleFromCorporationServer()

	// Set breadcrumb
	const { setCustomLabel, clearCustomLabel } = useBreadcrumb()
	useEffect(() => {
		if (corporation) {
			setCustomLabel(`/admin/corporations/${corpId}`, corporation.name)
		}

		// Cleanup function to clear the breadcrumb label when component unmounts or corpId changes
		return () => {
			clearCustomLabel(`/admin/corporations/${corpId}`)
		}
	}, [corporation, corpId, setCustomLabel, clearCustomLabel])

	// Message handling with automatic cleanup
	const { message, showSuccess, showError } = useMessage()

	// Discord UI state
	const [showAddServerDialog, setShowAddServerDialog] = useState(false)
	const [selectedServerId, setSelectedServerId] = useState('')
	const [attachmentSettings, setAttachmentSettings] = useState({
		autoInvite: false,
		autoAssignRoles: false,
	})

	// Handlers for Discord servers
	const handleAttachServer = async () => {
		if (!selectedServerId) return

		try {
			await attachServer.mutateAsync({
				corporationId: corpId,
				data: {
					discordServerId: selectedServerId,
					autoInvite: attachmentSettings.autoInvite,
					autoAssignRoles: attachmentSettings.autoAssignRoles,
				},
			})
			setShowAddServerDialog(false)
			setSelectedServerId('')
			setAttachmentSettings({ autoInvite: false, autoAssignRoles: false })
			showSuccess('Discord server attached successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to attach Discord server')
		}
	}

	const handleDetachServer = async (attachmentId: string) => {
		try {
			await detachServer.mutateAsync({ corporationId: corpId, attachmentId })
			showSuccess('Discord server detached successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to detach Discord server')
		}
	}

	const handleToggleAutoInvite = async (attachmentId: string, currentValue: boolean) => {
		try {
			await updateAttachment.mutateAsync({
				corporationId: corpId,
				attachmentId,
				data: { autoInvite: !currentValue },
			})
			showSuccess('Auto-invite setting updated!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update auto-invite setting')
		}
	}

	const handleToggleAutoAssignRoles = async (attachmentId: string, currentValue: boolean) => {
		try {
			await updateAttachment.mutateAsync({
				corporationId: corpId,
				attachmentId,
				data: { autoAssignRoles: !currentValue },
			})
			showSuccess('Auto-assign roles setting updated!')
		} catch (error) {
			showError(
				error instanceof Error ? error.message : 'Failed to update auto-assign roles setting'
			)
		}
	}

	const handleAssignRole = async (attachmentId: string, discordRoleId: string) => {
		try {
			await assignRole.mutateAsync({
				corporationId: corpId,
				attachmentId,
				data: { discordRoleId },
			})
			showSuccess('Role assigned successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to assign role')
		}
	}

	const handleUnassignRole = async (attachmentId: string, roleAssignmentId: string) => {
		try {
			await unassignRole.mutateAsync({
				corporationId: corpId,
				attachmentId,
				roleAssignmentId,
			})
			showSuccess('Role unassigned successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to unassign role')
		}
	}

	const handleVerify = async () => {
		try {
			const result = await verifyAccess.mutateAsync(corpId)
			if (result.hasAccess) {
				showSuccess(`Access verified! Roles: ${result.verifiedRoles.join(', ')}`)
			} else {
				showError(
					`Verification failed. Missing roles: ${result.missingRoles?.join(', ') || 'Unknown'}`
				)
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to verify access')
		}
	}

	const handleFetch = async (category: string) => {
		try {
			await fetchData.mutateAsync({ corporationId: corpId, data: { category: category as any } })
			showSuccess(`Started fetching ${category} data...`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to fetch data')
		}
	}

	const formatDate = (date: string | null) => {
		if (!date) return 'Never'
		return formatDistanceToNow(new Date(date), { addSuffix: true })
	}

	if (isLoading) {
		return (
			<div className="flex justify-center py-12">
				<LoadingSpinner label="Loading corporation..." />
			</div>
		)
	}

	if (!corporation) {
		return (
			<div className="text-center py-12">
				<Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
				<h3 className="mt-4 text-lg font-medium">Corporation not found</h3>
				<p className="text-muted-foreground mt-2">This corporation may have been removed.</p>
				<Button asChild className="mt-4">
					<Link to="/admin/corporations">
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back to Corporations
					</Link>
				</Button>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Back Button */}
			<Button variant="ghost" asChild>
				<Link to="/admin/corporations">
					<ArrowLeft className="mr-2 h-4 w-4" />
					Back to Corporations
				</Link>
			</Button>

			{/* Page Header */}
			<div className="flex items-start justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{corporation.name}</h1>
					<p className="text-muted-foreground mt-1">[{corporation.ticker}]</p>
				</div>
				<div className="flex gap-2">
					{corporation.assignedCharacterId && (
						<Button onClick={handleVerify} disabled={verifyAccess.isPending}>
							<Shield className="mr-2 h-4 w-4" />
							{verifyAccess.isPending ? 'Verifying...' : 'Verify Access'}
						</Button>
					)}
				</div>
			</div>

			{/* Success/Error Message */}
			{message && (
				<Card
					className={
						message.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Status Overview */}
			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Status</CardTitle>
						{corporation.isActive ? (
							<CheckCircle2 className="h-4 w-4 text-green-600" />
						) : (
							<XCircle className="h-4 w-4 text-muted-foreground" />
						)}
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{corporation.isActive ? 'Active' : 'Inactive'}</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Last Sync</CardTitle>
						<RefreshCw className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{formatDate(corporation.lastSync)}</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Verification</CardTitle>
						{corporation.isVerified ? (
							<ShieldCheck className="h-4 w-4 text-green-600" />
						) : (
							<ShieldAlert className="h-4 w-4 text-destructive" />
						)}
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{corporation.isVerified ? 'Verified' : 'Unverified'}
						</div>
						<p className="text-xs text-muted-foreground mt-1">
							{formatDate(corporation.lastVerified)}
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Tabs */}
			<Tabs defaultValue="config" className="space-y-4">
				<TabsList>
					<TabsTrigger value="config">Configuration</TabsTrigger>
					<TabsTrigger value="data">Data Summary</TabsTrigger>
					<TabsTrigger value="fetch">Fetch Data</TabsTrigger>
				</TabsList>

				{/* Configuration Tab */}
				<TabsContent value="config" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Directors</CardTitle>
							<CardDescription>
								Manage director characters with access to corporation data via ESI. Multiple
								directors provide automatic failover and load balancing.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<DirectorList corporationId={corpId} />
						</CardContent>
					</Card>

					{/* Discord Servers Card */}
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<div>
									<div className="flex items-center gap-2">
										<MessageSquare className="h-5 w-5 text-[hsl(var(--discord-blurple))]" />
										<CardTitle>Discord Servers</CardTitle>
									</div>
									<CardDescription>
										Attach Discord servers from the registry to enable auto-invite for corporation
										members. Each server can be configured independently with role assignments.
									</CardDescription>
								</div>
								<Button
									onClick={() => setShowAddServerDialog(true)}
									disabled={discordServers.length === 0}
									size="sm"
								>
									<Plus className="mr-2 h-4 w-4" />
									Attach Server
								</Button>
							</div>
						</CardHeader>
						<CardContent>
							{corporationDiscordServers.length === 0 ? (
								<div className="text-center py-8">
									<MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
									<h3 className="mt-4 text-sm font-medium">No Discord servers attached</h3>
									<p className="text-sm text-muted-foreground mt-2">
										Attach a Discord server from the registry to enable auto-invite
									</p>
									{discordServers.length === 0 && (
										<p className="text-xs text-muted-foreground mt-2">
											<Link to="/admin/discord-servers" className="text-primary hover:underline">
												Add servers to the registry first
											</Link>
										</p>
									)}
								</div>
							) : (
								<div className="space-y-4">
									{corporationDiscordServers.map((attachment) => (
										<div key={attachment.id} className="rounded-lg border p-4 space-y-3">
											<div className="flex items-start justify-between">
												<div>
													<h4 className="font-medium">{attachment.discordServer?.guildName}</h4>
													<p className="text-xs text-muted-foreground">
														ID: {attachment.discordServer?.guildId}
													</p>
													{attachment.discordServer?.description && (
														<p className="text-sm text-muted-foreground mt-1">
															{attachment.discordServer.description}
														</p>
													)}
												</div>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleDetachServer(attachment.id)}
												>
													<Trash2 className="h-4 w-4 text-destructive" />
												</Button>
											</div>

											<div className="flex gap-4">
												<div className="flex items-center space-x-2">
													<Switch
														id={`auto-invite-${attachment.id}`}
														checked={attachment.autoInvite}
														onCheckedChange={() =>
															handleToggleAutoInvite(attachment.id, attachment.autoInvite)
														}
													/>
													<Label
														htmlFor={`auto-invite-${attachment.id}`}
														className="cursor-pointer"
													>
														Auto-Invite
													</Label>
												</div>

												<div className="flex items-center space-x-2">
													<Switch
														id={`auto-assign-${attachment.id}`}
														checked={attachment.autoAssignRoles}
														onCheckedChange={() =>
															handleToggleAutoAssignRoles(attachment.id, attachment.autoAssignRoles)
														}
													/>
													<Label
														htmlFor={`auto-assign-${attachment.id}`}
														className="cursor-pointer"
													>
														Auto-Assign Roles
													</Label>
												</div>
											</div>

											{/* Role Management */}
											{attachment.discordServer?.roles &&
												attachment.discordServer.roles.length > 0 && (
													<div className="space-y-2">
														<p className="text-sm font-medium">Assigned Roles</p>
														<div className="flex flex-wrap gap-2">
															{attachment.roles?.map((roleAssignment) => (
																<div
																	key={roleAssignment.id}
																	className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-sm"
																>
																	<span>{roleAssignment.discordRole.roleName}</span>
																	<button
																		onClick={() =>
																			handleUnassignRole(attachment.id, roleAssignment.id)
																		}
																		className="ml-1 hover:text-destructive"
																	>
																		<X className="h-3 w-3" />
																	</button>
																</div>
															))}
														</div>

														{/* Role Selection */}
														{attachment.discordServer.roles.filter(
															(role) =>
																!attachment.roles?.some(
																	(ra) => ra.discordRole.roleId === role.roleId
																)
														).length > 0 && (
															<div className="flex gap-2 items-center">
																<select
																	className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
																	onChange={(e) => {
																		if (e.target.value) {
																			handleAssignRole(attachment.id, e.target.value)
																			e.target.value = ''
																		}
																	}}
																	defaultValue=""
																>
																	<option value="" disabled>
																		Add role...
																	</option>
																	{attachment.discordServer.roles
																		.filter(
																			(role) =>
																				!attachment.roles?.some(
																					(ra) => ra.discordRole.roleId === role.roleId
																				)
																		)
																		.map((role) => (
																			<option key={role.id} value={role.id}>
																				{role.roleName}
																			</option>
																		))}
																</select>
															</div>
														)}
													</div>
												)}
										</div>
									))}
								</div>
							)}

							{/* Add Server Dialog */}
							<Dialog open={showAddServerDialog} onOpenChange={setShowAddServerDialog}>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>Attach Discord Server</DialogTitle>
										<DialogDescription>
											Select a Discord server from the registry to attach to this corporation
										</DialogDescription>
									</DialogHeader>

									<div className="space-y-4">
										<div className="space-y-2">
											<Label htmlFor="discord-server">Select Server</Label>
											<select
												id="discord-server"
												className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
												value={selectedServerId}
												onChange={(e) => setSelectedServerId(e.target.value)}
											>
												<option value="">Choose a server...</option>
												{discordServers
													.filter(
														(server) =>
															!corporationDiscordServers.some(
																(att) => att.discordServerId === server.id
															)
													)
													.map((server) => (
														<option key={server.id} value={server.id}>
															{server.guildName}
														</option>
													))}
											</select>
										</div>

										<div className="space-y-3">
											<div className="flex items-center space-x-2">
												<Switch
													id="attach-auto-invite"
													checked={attachmentSettings.autoInvite}
													onCheckedChange={(checked) =>
														setAttachmentSettings({ ...attachmentSettings, autoInvite: checked })
													}
												/>
												<Label htmlFor="attach-auto-invite" className="cursor-pointer">
													Enable Auto-Invite
												</Label>
											</div>

											<div className="flex items-center space-x-2">
												<Switch
													id="attach-auto-assign"
													checked={attachmentSettings.autoAssignRoles}
													onCheckedChange={(checked) =>
														setAttachmentSettings({
															...attachmentSettings,
															autoAssignRoles: checked,
														})
													}
												/>
												<Label htmlFor="attach-auto-assign" className="cursor-pointer">
													Auto-Assign Roles
												</Label>
											</div>
										</div>
									</div>

									<DialogFooter>
										<CancelButton onClick={() => setShowAddServerDialog(false)}>
											Cancel
										</CancelButton>
										<ConfirmButton onClick={handleAttachServer} disabled={!selectedServerId} showIcon={false}>
											<Plus className="mr-2 h-4 w-4" />
											Attach
										</ConfirmButton>
									</DialogFooter>
								</DialogContent>
							</Dialog>
						</CardContent>
					</Card>
				</TabsContent>

				{/* Data Summary Tab */}
				<TabsContent value="data" className="space-y-4">
					{summaryLoading ? (
						<div className="flex justify-center py-8">
							<LoadingSpinner label="Loading data summary..." />
						</div>
					) : (
						<div className="grid gap-4 md:grid-cols-2">
							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="text-sm font-medium">Members</CardTitle>
									<Users className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="text-2xl font-bold">
										{dataSummary?.coreData?.memberCount || 0}
									</div>
									<p className="text-xs text-muted-foreground">
										{dataSummary?.coreData?.trackingCount || 0} with tracking data
									</p>
								</CardContent>
							</Card>

							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="text-sm font-medium">Wallets</CardTitle>
									<Wallet className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="text-2xl font-bold">
										{dataSummary?.financialData?.walletCount || 0}
									</div>
									<p className="text-xs text-muted-foreground">
										{dataSummary?.financialData?.journalCount || 0} journal entries
									</p>
								</CardContent>
							</Card>

							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="text-sm font-medium">Assets</CardTitle>
									<Package className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="text-2xl font-bold">
										{dataSummary?.assetsData?.assetCount || 0}
									</div>
									<p className="text-xs text-muted-foreground">
										{dataSummary?.assetsData?.structureCount || 0} structures
									</p>
								</CardContent>
							</Card>

							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="text-sm font-medium">Market</CardTitle>
									<TrendingUp className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="text-2xl font-bold">
										{dataSummary?.marketData?.orderCount || 0}
									</div>
									<p className="text-xs text-muted-foreground">
										{dataSummary?.marketData?.contractCount || 0} contracts
									</p>
								</CardContent>
							</Card>

							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="text-sm font-medium">Killmails</CardTitle>
									<Skull className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="text-2xl font-bold">{dataSummary?.killmailCount || 0}</div>
									<p className="text-xs text-muted-foreground">Recent killmails</p>
								</CardContent>
							</Card>
						</div>
					)}
				</TabsContent>

				{/* Fetch Data Tab */}
				<TabsContent value="fetch" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Fetch Corporation Data</CardTitle>
							<CardDescription>
								Trigger data fetches from EVE ESI. Requires assigned director with proper roles.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="grid gap-3">
								<Button
									onClick={() => handleFetch('all')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Database className="mr-2 h-4 w-4" />
									Fetch All Data
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('public')}
									disabled={fetchData.isPending}
									className="w-full justify-start"
								>
									<Building2 className="mr-2 h-4 w-4" />
									Fetch Public Data
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('core')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Users className="mr-2 h-4 w-4" />
									Fetch Members & Tracking
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('financial')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Wallet className="mr-2 h-4 w-4" />
									Fetch Financial Data
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('assets')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Package className="mr-2 h-4 w-4" />
									Fetch Assets & Structures
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('market')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<TrendingUp className="mr-2 h-4 w-4" />
									Fetch Market Data
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('killmails')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Skull className="mr-2 h-4 w-4" />
									Fetch Killmails
								</Button>
							</div>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	)
}
