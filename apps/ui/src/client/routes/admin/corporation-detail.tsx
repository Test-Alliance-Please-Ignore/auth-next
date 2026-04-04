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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBreadcrumb } from '@/hooks/useBreadcrumb'
import {
	useAttachCorporationPermission,
	useCorporation,
	useCorporationDataSummary,
	useCorporationPermissions,
	useFetchCorporationData,
	useRefreshCorporationDiscord,
	useRemoveCorporationPermission,
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
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useGlobalPermissions } from '@/hooks/usePermissions'

import type { UpdateCorporationRequest } from '@/lib/api'

export default function CorporationDetailPage() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const corpId = corporationId || ''

	const { data: corporation, isLoading } = useCorporation(corpId)

	// Set dynamic page title based on corporation name
	usePageTitle(corporation?.name ? `Admin - ${corporation.name}` : 'Admin - Corporation Details')
	const { data: dataSummary, isLoading: summaryLoading } = useCorporationDataSummary(corpId)
	const updateCorporation = useUpdateCorporation()
	const verifyAccess = useVerifyCorporationAccess()
	const fetchData = useFetchCorporationData()

	// Discord hooks
	const refreshCorporationDiscord = useRefreshCorporationDiscord()
	const { data: discordServers = [] } = useDiscordServers()
	const { data: corporationDiscordServers = [] } = useCorporationDiscordServers(corpId)
	const attachServer = useAttachDiscordServer()
	const detachServer = useDetachDiscordServer()
	const updateAttachment = useUpdateCorporationDiscordServer()
	const assignRole = useAssignRoleToCorporationServer()
	const unassignRole = useUnassignRoleFromCorporationServer()

	// Permission hooks
	const { data: corporationPermissions = [], isLoading: permissionsLoading } =
		useCorporationPermissions(corpId)
	const { data: globalPermissions = [] } = useGlobalPermissions()
	const attachPermission = useAttachCorporationPermission()
	const removePermission = useRemoveCorporationPermission()

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
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	// Discord UI state
	const [showAddServerDialog, setShowAddServerDialog] = useState(false)
	const [selectedServerId, setSelectedServerId] = useState('')
	const [pendingRoleSelections, setPendingRoleSelections] = useState<Record<string, string>>({})
	const [attachmentSettings, setAttachmentSettings] = useState({
		autoInvite: false,
		autoAssignRoles: false,
	})

	// Permission UI state
	const [showAttachPermissionDialog, setShowAttachPermissionDialog] = useState(false)
	const [selectedPermissionId, setSelectedPermissionId] = useState('')

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

	// Handlers for permissions
	const handleAttachPermission = async () => {
		if (!selectedPermissionId) return

		try {
			await attachPermission.mutateAsync({
				corporationId: corpId,
				permissionId: selectedPermissionId,
			})
			setShowAttachPermissionDialog(false)
			setSelectedPermissionId('')
			showSuccess('Permission attached successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to attach permission')
		}
	}

	const handleRemovePermission = async (permissionId: string) => {
		try {
			await removePermission.mutateAsync({
				corporationId: corpId,
				permissionId,
			})
			showSuccess('Permission removed successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to remove permission')
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

	const handleUpdateBackgroundRefresh = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { includeInBackgroundRefresh: enabled },
			})
			showSuccess(`Background refresh ${enabled ? 'enabled' : 'disabled'}`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update setting')
		}
	}

	const handleUpdateMemberCorporation = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { isMemberCorporation: enabled },
			})
			showSuccess(`Member corporation status ${enabled ? 'enabled' : 'disabled'}`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update setting')
		}
	}

	const handleUpdateAltCorp = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { isAltCorp: enabled },
			})
			showSuccess(`Alt corporation status ${enabled ? 'enabled' : 'disabled'}`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update setting')
		}
	}

	const handleUpdateSpecialPurpose = async (enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId: corpId,
				data: { isSpecialPurpose: enabled },
			})
			showSuccess(`Special purpose status ${enabled ? 'enabled' : 'disabled'}`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update setting')
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
		<>
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
					<TabsTrigger value="permissions">Permissions</TabsTrigger>
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

					{/* Data Collection Settings Card */}
					<Card>
						<CardHeader>
							<div className="flex items-center gap-2">
								<RefreshCw className="h-5 w-5 text-muted-foreground" />
								<CardTitle>Data Collection Settings</CardTitle>
							</div>
							<CardDescription>
								Configure automatic data fetching and synchronization behavior
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex items-center justify-between">
								<div className="space-y-1">
									<div className="flex items-center space-x-2">
										<Switch
											id="background-refresh"
											checked={corporation.includeInBackgroundRefresh}
											onCheckedChange={(checked) => handleUpdateBackgroundRefresh(checked)}
											disabled={updateCorporation.isPending}
										/>
										<Label htmlFor="background-refresh" className="cursor-pointer font-medium">
											Include in Background Refresh
										</Label>
									</div>
									<p className="text-sm text-muted-foreground ml-11">
										When enabled, corporation data will be automatically fetched and updated on a
										regular schedule
									</p>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Corporation Classification Settings Card */}
					<Card>
						<CardHeader>
							<div className="flex items-center gap-2">
								<Settings className="h-5 w-5 text-muted-foreground" />
								<CardTitle>Corporation Classification</CardTitle>
							</div>
							<CardDescription>
								Categorize this corporation for filtering and organizational purposes
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex items-center justify-between">
								<div className="space-y-1">
									<div className="flex items-center space-x-2">
										<Switch
											id="member-corporation"
											checked={corporation.isMemberCorporation}
											onCheckedChange={(checked) => handleUpdateMemberCorporation(checked)}
											disabled={updateCorporation.isPending}
										/>
										<Label htmlFor="member-corporation" className="cursor-pointer font-medium">
											Member Corporation
										</Label>
									</div>
									<p className="text-sm text-muted-foreground ml-11">
										Mark this corporation as a member of the alliance
									</p>
								</div>
							</div>

							<div className="flex items-center justify-between">
								<div className="space-y-1">
									<div className="flex items-center space-x-2">
										<Switch
											id="alt-corp"
											checked={corporation.isAltCorp}
											onCheckedChange={(checked) => handleUpdateAltCorp(checked)}
											disabled={updateCorporation.isPending}
										/>
										<Label htmlFor="alt-corp" className="cursor-pointer font-medium">
											Alt Corporation
										</Label>
									</div>
									<p className="text-sm text-muted-foreground ml-11">
										Mark this corporation as an alt corp
									</p>
								</div>
							</div>

							<div className="flex items-center justify-between">
								<div className="space-y-1">
									<div className="flex items-center space-x-2">
										<Switch
											id="special-purpose"
											checked={corporation.isSpecialPurpose}
											onCheckedChange={(checked) => handleUpdateSpecialPurpose(checked)}
											disabled={updateCorporation.isPending}
										/>
										<Label htmlFor="special-purpose" className="cursor-pointer font-medium">
											Special Purpose Corporation
										</Label>
									</div>
									<p className="text-sm text-muted-foreground ml-11">
										Mark this corporation as a special purpose corp
									</p>
								</div>
							</div>
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
								<div className="flex items-center gap-2">
									<Button
										variant="ghost"
										size="sm"
										disabled={refreshCorporationDiscord.isPending}
										onClick={() => {
											refreshCorporationDiscord.mutate(
												{ corporationId: corpId, allowRemoval: true },
												{
													onSuccess: (data) =>
														showSuccess(
															data.message || `Discord refresh queued for ${data.usersQueued} users`
														),
													onError: (error) =>
														showError(
															error instanceof Error ? error.message : 'Failed to refresh Discord'
														),
												}
											)
										}}
									>
										<RefreshCw
											className={`mr-2 h-4 w-4 ${refreshCorporationDiscord.isPending ? 'animate-spin' : ''}`}
										/>
										Refresh All Members
									</Button>
									<Button
										onClick={() => setShowAddServerDialog(true)}
										disabled={discordServers.length === 0}
										size="sm"
									>
										<Plus className="mr-2 h-4 w-4" />
										Attach Server
									</Button>
								</div>
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
																<Select
																	value=""
																	onValueChange={(nextValue) => {
																		if (!nextValue) {
																			return
																		}
																		void handleAssignRole(attachment.id, nextValue).finally(() => {
																			setPendingRoleSelections((prev) => {
																				const { [attachment.id]: _, ...rest } = prev
																				return rest
																			})
																		})
																	}}
																	query={pendingRoleSelections[attachment.id] ?? ''}
																	onQueryChange={(value) =>
																		setPendingRoleSelections((prev) => ({
																			...prev,
																			[attachment.id]: value,
																		}))
																	}
																	searchable
																	options={attachment.discordServer.roles
																		.filter(
																			(role) =>
																				!attachment.roles?.some(
																					(ra) => ra.discordRole.roleId === role.roleId
																				)
																		)
																		.map((role) => ({ value: role.id,
																			label: role.roleName,
																		}))}
																	placeholder="Add role..."
																	emptyText="No matching roles found"
																	className="w-full"
																	contentClassName="w-[min(90vw,36rem)]"
																	inputClassName="h-9"
																/>
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
											<Select
												inputId="discord-server"
												value={selectedServerId}
												onValueChange={setSelectedServerId}
												options={discordServers
													.filter(
														(server) =>
															!corporationDiscordServers.some(
																(att) => att.discordServerId === server.id
															)
													)
													.map((server) => ({ value: server.id,
														label: server.guildName,
													}))}
												placeholder="Choose a server..."
												className="w-full"
											/>
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
										<Button variant="cancel" onClick={() => setShowAddServerDialog(false)}>
											Cancel
										</Button>
										<Button variant="confirm"
											onClick={handleAttachServer}
											disabled={!selectedServerId}
											showIcon={false}
										>
											<Plus className="mr-2 h-4 w-4" />
											Attach
										</Button>
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
									variant="ghost"
									onClick={() => handleFetch('public')}
									disabled={fetchData.isPending}
									className="w-full justify-start"
								>
									<Building2 className="mr-2 h-4 w-4" />
									Fetch Public Data
								</Button>
								<Button
									variant="ghost"
									onClick={() => handleFetch('core')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Users className="mr-2 h-4 w-4" />
									Fetch Members & Tracking
								</Button>
								<Button
									variant="ghost"
									onClick={() => handleFetch('financial')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Wallet className="mr-2 h-4 w-4" />
									Fetch Financial Data
								</Button>
								<Button
									variant="ghost"
									onClick={() => handleFetch('assets')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Package className="mr-2 h-4 w-4" />
									Fetch Assets & Structures
								</Button>
								<Button
									variant="ghost"
									onClick={() => handleFetch('market')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<TrendingUp className="mr-2 h-4 w-4" />
									Fetch Market Data
								</Button>
								<Button
									variant="ghost"
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

				{/* Permissions Tab */}
				<TabsContent value="permissions" className="space-y-4">
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<div>
									<CardTitle>Corporation Permissions</CardTitle>
									<CardDescription>
										Manage permissions for all members of this corporation. Permissions are
										automatically inherited by all corporation members.
									</CardDescription>
								</div>
								<Button onClick={() => setShowAttachPermissionDialog(true)}>
									<Plus className="mr-2 h-4 w-4" />
									Attach Permission
								</Button>
							</div>
						</CardHeader>
						<CardContent>
							{permissionsLoading ? (
								<LoadingSpinner />
							) : corporationPermissions.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									No permissions attached to this corporation.
								</p>
							) : (
								<div className="space-y-2">
									{corporationPermissions.map((perm) => (
										<Card key={perm.id} className="p-4">
											<div className="flex items-start justify-between">
												<div className="flex-1">
													<div className="flex items-center gap-2">
														<Shield className="h-4 w-4 text-muted-foreground" />
														<h4 className="font-semibold">{perm.permission.name}</h4>
													</div>
													<p className="mt-1 text-sm text-muted-foreground">
														{perm.permission.urn}
													</p>
													{perm.permission.description && (
														<p className="mt-1 text-sm">{perm.permission.description}</p>
													)}
													{perm.permission.category && (
														<div className="mt-2 inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs">
															{perm.permission.category.name}
														</div>
													)}
													<p className="mt-2 text-xs text-muted-foreground">
														Added {new Date(perm.createdAt).toLocaleDateString()}
													</p>
												</div>
												<Button
													variant="danger"
													size="sm"
													showIcon={false}
													onClick={() =>
														requestConfirmation({
															title: 'Remove Permission',
															description:
																'Are you sure you want to remove this permission from the corporation?',
															confirmLabel: 'Remove',
															intent: 'destructive',
															onConfirm: () => handleRemovePermission(perm.id),
														})
													}
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										</Card>
									))}
								</div>
							)}
						</CardContent>
					</Card>

					{/* Attach Permission Dialog */}
					<Dialog open={showAttachPermissionDialog} onOpenChange={setShowAttachPermissionDialog}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Attach Permission to Corporation</DialogTitle>
								<DialogDescription>
									Select a global permission to attach to this corporation. All members will
									automatically inherit this permission.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4">
								<div>
									<Label htmlFor="permission">Permission</Label>
									<Select
										inputId="permission"
										value={selectedPermissionId}
										onValueChange={setSelectedPermissionId}
										options={globalPermissions
											.filter(
												(gp) => !corporationPermissions.some((cp) => cp.permissionId === gp.id)
											)
											.map((perm) => ({ value: perm.id,
												label: `${perm.name} (${perm.urn})`,
											}))}
										placeholder="Select a permission..."
										className="mt-1.5 w-full"
									/>
								</div>
							</div>
							<DialogFooter>
								<Button variant="cancel" onClick={() => setShowAttachPermissionDialog(false)}>
									Cancel
								</Button>
								<Button variant="confirm"
									onClick={handleAttachPermission}
									disabled={!selectedPermissionId || attachPermission.isPending}
								>
									Attach Permission
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</TabsContent>
			</Tabs>
		</div>
		{confirmationDialog}
		</>
	)
}
