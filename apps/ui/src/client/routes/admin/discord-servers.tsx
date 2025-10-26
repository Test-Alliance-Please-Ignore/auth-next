import { Edit, MessageSquare, Plus, Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { DestructiveButton } from '@/components/ui/destructive-button'
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
import {
	useCreateDiscordRole,
	useCreateDiscordServer,
	useDeleteDiscordRole,
	useDeleteDiscordServer,
	useDiscordServers,
	useUpdateDiscordRole,
	useUpdateDiscordServer,
} from '@/hooks/useDiscord'
import { useMessage } from '@/hooks/useMessage'

import type {
	CreateDiscordRoleRequest,
	CreateDiscordServerRequest,
	DiscordServerWithRoles,
	UpdateDiscordRoleRequest,
	UpdateDiscordServerRequest,
} from '@/lib/api'

export default function DiscordServersPage() {
	const { data: discordServers, isLoading } = useDiscordServers()
	const createServer = useCreateDiscordServer()
	const updateServer = useUpdateDiscordServer()
	const deleteServer = useDeleteDiscordServer()
	const createRole = useCreateDiscordRole()
	const updateRole = useUpdateDiscordRole()
	const deleteRole = useDeleteDiscordRole()

	const { message, showSuccess, showError } = useMessage()

	// Server dialog state
	const [createServerDialogOpen, setCreateServerDialogOpen] = useState(false)
	const [editServerDialogOpen, setEditServerDialogOpen] = useState(false)
	const [deleteServerDialogOpen, setDeleteServerDialogOpen] = useState(false)
	const [selectedServer, setSelectedServer] = useState<DiscordServerWithRoles | null>(null)

	// Role dialog state
	const [createRoleDialogOpen, setCreateRoleDialogOpen] = useState(false)
	const [editRoleDialogOpen, setEditRoleDialogOpen] = useState(false)
	const [deleteRoleDialogOpen, setDeleteRoleDialogOpen] = useState(false)
	const [selectedRole, setSelectedRole] = useState<{
		serverId: string
		roleId: string
		roleName: string
		description: string | null
		isActive: boolean
		autoApply: boolean
	} | null>(null)

	// Form state
	const [serverFormData, setServerFormData] = useState<CreateDiscordServerRequest>({
		guildId: '',
		guildName: '',
		description: '',
	})

	const [serverEditFormData, setServerEditFormData] = useState<UpdateDiscordServerRequest>({
		guildName: '',
		description: '',
		isActive: true,
	})

	const [roleFormData, setRoleFormData] = useState<CreateDiscordRoleRequest>({
		roleId: '',
		roleName: '',
		description: '',
		autoApply: false,
	})

	const [roleEditFormData, setRoleEditFormData] = useState<UpdateDiscordRoleRequest>({
		roleName: '',
		description: '',
		isActive: true,
		autoApply: false,
	})

	// Server handlers
	const handleCreateServer = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!serverFormData.guildId || !serverFormData.guildName) {
			showError('Guild ID and name are required')
			return
		}

		try {
			await createServer.mutateAsync(serverFormData)
			setCreateServerDialogOpen(false)
			setServerFormData({
				guildId: '',
				guildName: '',
				description: '',
			})
			showSuccess('Discord server added successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to add Discord server')
		}
	}

	const handleUpdateServer = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!selectedServer) return

		try {
			await updateServer.mutateAsync({
				serverId: selectedServer.id,
				data: serverEditFormData,
			})
			setEditServerDialogOpen(false)
			setSelectedServer(null)
			showSuccess('Discord server updated successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update Discord server')
		}
	}

	const handleDeleteServer = async () => {
		if (!selectedServer) return

		try {
			await deleteServer.mutateAsync(selectedServer.id)
			setDeleteServerDialogOpen(false)
			setSelectedServer(null)
			showSuccess('Discord server deleted successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to delete Discord server')
		}
	}

	const openEditServerDialog = (server: DiscordServerWithRoles) => {
		setSelectedServer(server)
		setServerEditFormData({
			guildName: server.guildName,
			description: server.description || '',
			isActive: server.isActive,
		})
		setEditServerDialogOpen(true)
	}

	const openDeleteServerDialog = (server: DiscordServerWithRoles) => {
		setSelectedServer(server)
		setDeleteServerDialogOpen(true)
	}

	// Role handlers
	const handleCreateRole = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!selectedServer || !roleFormData.roleId || !roleFormData.roleName) {
			showError('Role ID and name are required')
			return
		}

		try {
			await createRole.mutateAsync({
				serverId: selectedServer.id,
				data: roleFormData,
			})
			setCreateRoleDialogOpen(false)
			setRoleFormData({
				roleId: '',
				roleName: '',
				description: '',
				autoApply: false,
			})
			showSuccess('Role added successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to add role')
		}
	}

	const handleUpdateRole = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!selectedRole) return

		try {
			await updateRole.mutateAsync({
				serverId: selectedRole.serverId,
				roleId: selectedRole.roleId,
				data: roleEditFormData,
			})
			setEditRoleDialogOpen(false)
			setSelectedRole(null)
			showSuccess('Role updated successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update role')
		}
	}

	const handleDeleteRole = async () => {
		if (!selectedRole) return

		try {
			await deleteRole.mutateAsync({
				serverId: selectedRole.serverId,
				roleId: selectedRole.roleId,
			})
			setDeleteRoleDialogOpen(false)
			setSelectedRole(null)
			showSuccess('Role deleted successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to delete role')
		}
	}

	const openCreateRoleDialog = (server: DiscordServerWithRoles) => {
		setSelectedServer(server)
		setRoleFormData({
			roleId: '',
			roleName: '',
			description: '',
			autoApply: false,
		})
		setCreateRoleDialogOpen(true)
	}

	const openEditRoleDialog = (
		serverId: string,
		roleId: string,
		roleName: string,
		description: string | null,
		isActive: boolean,
		autoApply: boolean
	) => {
		setSelectedRole({ serverId, roleId, roleName, description, isActive, autoApply })
		setRoleEditFormData({
			roleName,
			description: description || '',
			isActive,
			autoApply,
		})
		setEditRoleDialogOpen(true)
	}

	const openDeleteRoleDialog = (serverId: string, roleId: string, roleName: string) => {
		setSelectedRole({
			serverId,
			roleId,
			roleName,
			description: null,
			isActive: true,
			autoApply: false,
		})
		setDeleteRoleDialogOpen(true)
	}

	if (isLoading) {
		return (
			<div className="flex justify-center py-12">
				<LoadingSpinner label="Loading Discord servers..." />
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-start justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text flex items-center gap-2">
						<MessageSquare className="h-8 w-8 text-[hsl(var(--discord-blurple))]" />
						Discord Servers
					</h1>
					<p className="text-muted-foreground mt-1">
						Manage the Discord server registry and roles for auto-invite
					</p>
				</div>
				<Button onClick={() => setCreateServerDialogOpen(true)}>
					<Plus className="mr-2 h-4 w-4" />
					Add Server
				</Button>
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

			{/* Discord Servers List */}
			{!discordServers || discordServers.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
						<h3 className="mt-4 text-lg font-medium">No Discord servers</h3>
						<p className="text-muted-foreground mt-2">
							Add a Discord server to the registry to get started
						</p>
						<Button onClick={() => setCreateServerDialogOpen(true)} className="mt-4">
							<Plus className="mr-2 h-4 w-4" />
							Add Server
						</Button>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-6">
					{discordServers.map((server) => (
						<Card key={server.id}>
							<CardHeader>
								<div className="flex items-start justify-between">
									<div>
										<CardTitle className="flex items-center gap-2">
											{server.guildName}
											{!server.isActive && (
												<span className="text-xs font-normal text-muted-foreground">
													(Inactive)
												</span>
											)}
										</CardTitle>
										<CardDescription>
											Guild ID: {server.guildId}
											{server.description && ` • ${server.description}`}
										</CardDescription>
									</div>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => openEditServerDialog(server)}
										>
											<Edit className="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => openDeleteServerDialog(server)}
										>
											<Trash2 className="h-4 w-4 text-destructive" />
										</Button>
									</div>
								</div>
							</CardHeader>
							<CardContent>
								<div className="space-y-3">
									<div className="flex items-center justify-between">
										<h4 className="text-sm font-medium">Roles</h4>
										<Button
											size="sm"
											variant="outline"
											onClick={() => openCreateRoleDialog(server)}
										>
											<Plus className="mr-2 h-3 w-3" />
											Add Role
										</Button>
									</div>

									{server.roles && server.roles.length > 0 ? (
										<div className="space-y-2">
											{server.roles.map((role) => (
												<div
													key={role.id}
													className="flex items-center justify-between rounded-lg border p-3"
												>
													<div className="flex-1">
														<div className="flex items-center gap-2">
															<p className="font-medium">{role.roleName}</p>
															{!role.isActive && (
																<span className="text-xs text-muted-foreground">(Inactive)</span>
															)}
															{role.autoApply && (
																<span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
																	Auto-apply
																</span>
															)}
														</div>
														<p className="text-xs text-muted-foreground">Role ID: {role.roleId}</p>
														{role.description && (
															<p className="text-sm text-muted-foreground mt-1">
																{role.description}
															</p>
														)}
													</div>
													<div className="flex gap-2">
														<Button
															variant="ghost"
															size="sm"
															onClick={() =>
																openEditRoleDialog(
																	server.id,
																	role.id,
																	role.roleName,
																	role.description,
																	role.isActive,
																	role.autoApply
																)
															}
														>
															<Edit className="h-4 w-4" />
														</Button>
														<Button
															variant="ghost"
															size="sm"
															onClick={() =>
																openDeleteRoleDialog(server.id, role.id, role.roleName)
															}
														>
															<Trash2 className="h-4 w-4 text-destructive" />
														</Button>
													</div>
												</div>
											))}
										</div>
									) : (
										<p className="text-sm text-muted-foreground text-center py-4">
											No roles configured. Add roles to assign them during auto-invite.
										</p>
									)}
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			{/* Create Server Dialog */}
			<Dialog open={createServerDialogOpen} onOpenChange={setCreateServerDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add Discord Server</DialogTitle>
						<DialogDescription>Add a new Discord server to the registry</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleCreateServer} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="guildId">Guild ID *</Label>
							<Input
								id="guildId"
								type="text"
								placeholder="e.g., 1234567890123456789"
								value={serverFormData.guildId}
								onChange={(e) => setServerFormData({ ...serverFormData, guildId: e.target.value })}
								required
							/>
							<p className="text-xs text-muted-foreground">
								Right-click the server in Discord → Copy Server ID
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="guildName">Server Name *</Label>
							<Input
								id="guildName"
								type="text"
								placeholder="e.g., My Discord Server"
								value={serverFormData.guildName}
								onChange={(e) =>
									setServerFormData({ ...serverFormData, guildName: e.target.value })
								}
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">Description (Optional)</Label>
							<Input
								id="description"
								type="text"
								placeholder="Brief description of this server"
								value={serverFormData.description}
								onChange={(e) =>
									setServerFormData({ ...serverFormData, description: e.target.value })
								}
							/>
						</div>

						<DialogFooter>
							<CancelButton type="button" onClick={() => setCreateServerDialogOpen(false)}>
								Cancel
							</CancelButton>
							<ConfirmButton type="submit" loading={createServer.isPending} loadingText="Adding...">
								Add Server
							</ConfirmButton>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Edit Server Dialog */}
			<Dialog open={editServerDialogOpen} onOpenChange={setEditServerDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Discord Server</DialogTitle>
						<DialogDescription>Update Discord server information</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleUpdateServer} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="edit-guildName">Server Name *</Label>
							<Input
								id="edit-guildName"
								type="text"
								value={serverEditFormData.guildName}
								onChange={(e) =>
									setServerEditFormData({ ...serverEditFormData, guildName: e.target.value })
								}
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="edit-description">Description (Optional)</Label>
							<Input
								id="edit-description"
								type="text"
								value={serverEditFormData.description}
								onChange={(e) =>
									setServerEditFormData({ ...serverEditFormData, description: e.target.value })
								}
							/>
						</div>

						<div className="flex items-center space-x-2">
							<Switch
								id="edit-isActive"
								checked={serverEditFormData.isActive ?? true}
								onCheckedChange={(checked) =>
									setServerEditFormData({ ...serverEditFormData, isActive: checked })
								}
							/>
							<Label htmlFor="edit-isActive" className="cursor-pointer">
								Active
							</Label>
						</div>

						<DialogFooter>
							<CancelButton type="button" onClick={() => setEditServerDialogOpen(false)}>
								Cancel
							</CancelButton>
							<ConfirmButton type="submit" loading={updateServer.isPending} loadingText="Updating...">
								Update Server
							</ConfirmButton>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete Server Dialog */}
			<Dialog open={deleteServerDialogOpen} onOpenChange={setDeleteServerDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Discord Server</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "{selectedServer?.guildName}"? This will remove all
							associated roles and detach this server from all corporations and groups.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton onClick={() => setDeleteServerDialogOpen(false)}>
							Cancel
						</CancelButton>
						<DestructiveButton
							onClick={handleDeleteServer}
							loading={deleteServer.isPending}
							loadingText="Deleting..."
						>
							Delete
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Create Role Dialog */}
			<Dialog open={createRoleDialogOpen} onOpenChange={setCreateRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add Role</DialogTitle>
						<DialogDescription>Add a new role to {selectedServer?.guildName}</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleCreateRole} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="roleId">Role ID *</Label>
							<Input
								id="roleId"
								type="text"
								placeholder="e.g., 9876543210987654321"
								value={roleFormData.roleId}
								onChange={(e) => setRoleFormData({ ...roleFormData, roleId: e.target.value })}
								required
							/>
							<p className="text-xs text-muted-foreground">
								Right-click the role in Discord → Copy Role ID
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="roleName">Role Name *</Label>
							<Input
								id="roleName"
								type="text"
								placeholder="e.g., Member"
								value={roleFormData.roleName}
								onChange={(e) => setRoleFormData({ ...roleFormData, roleName: e.target.value })}
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="role-description">Description (Optional)</Label>
							<Input
								id="role-description"
								type="text"
								placeholder="Brief description of this role"
								value={roleFormData.description}
								onChange={(e) => setRoleFormData({ ...roleFormData, description: e.target.value })}
							/>
						</div>

						<div className="flex items-center space-x-2">
							<Switch
								id="autoApply"
								checked={roleFormData.autoApply ?? false}
								onCheckedChange={(checked) =>
									setRoleFormData({ ...roleFormData, autoApply: checked })
								}
							/>
							<Label htmlFor="autoApply" className="cursor-pointer">
								Auto-apply to all users
							</Label>
						</div>
						<p className="text-xs text-muted-foreground">
							When enabled, this role will be automatically assigned to all users joining through
							the system, regardless of their corporation or group memberships.
						</p>

						<DialogFooter>
							<CancelButton type="button" onClick={() => setCreateRoleDialogOpen(false)}>
								Cancel
							</CancelButton>
							<ConfirmButton type="submit" loading={createRole.isPending} loadingText="Adding...">
								Add Role
							</ConfirmButton>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Edit Role Dialog */}
			<Dialog open={editRoleDialogOpen} onOpenChange={setEditRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Role</DialogTitle>
						<DialogDescription>Update role information</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleUpdateRole} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="edit-roleName">Role Name *</Label>
							<Input
								id="edit-roleName"
								type="text"
								value={roleEditFormData.roleName}
								onChange={(e) =>
									setRoleEditFormData({ ...roleEditFormData, roleName: e.target.value })
								}
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="edit-role-description">Description (Optional)</Label>
							<Input
								id="edit-role-description"
								type="text"
								value={roleEditFormData.description}
								onChange={(e) =>
									setRoleEditFormData({ ...roleEditFormData, description: e.target.value })
								}
							/>
						</div>

						<div className="flex items-center space-x-2">
							<Switch
								id="edit-role-isActive"
								checked={roleEditFormData.isActive ?? true}
								onCheckedChange={(checked) =>
									setRoleEditFormData({ ...roleEditFormData, isActive: checked })
								}
							/>
							<Label htmlFor="edit-role-isActive" className="cursor-pointer">
								Active
							</Label>
						</div>

						<div className="flex items-center space-x-2">
							<Switch
								id="edit-autoApply"
								checked={roleEditFormData.autoApply ?? false}
								onCheckedChange={(checked) =>
									setRoleEditFormData({ ...roleEditFormData, autoApply: checked })
								}
							/>
							<Label htmlFor="edit-autoApply" className="cursor-pointer">
								Auto-apply to all users
							</Label>
						</div>
						<p className="text-xs text-muted-foreground">
							When enabled, this role will be automatically assigned to all users joining through
							the system, regardless of their corporation or group memberships.
						</p>

						<DialogFooter>
							<CancelButton type="button" onClick={() => setEditRoleDialogOpen(false)}>
								Cancel
							</CancelButton>
							<ConfirmButton type="submit" loading={updateRole.isPending} loadingText="Updating...">
								Update Role
							</ConfirmButton>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete Role Dialog */}
			<Dialog open={deleteRoleDialogOpen} onOpenChange={setDeleteRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Role</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete the role "{selectedRole?.roleName}"? This will remove
							it from all corporation and group attachments.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton onClick={() => setDeleteRoleDialogOpen(false)}>
							Cancel
						</CancelButton>
						<DestructiveButton
							onClick={handleDeleteRole}
							loading={deleteRole.isPending}
							loadingText="Deleting..."
						>
							Delete
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
