import { ArrowLeft, Edit, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

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
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
	useCreateDiscordRole,
	useDeleteDiscordRole,
	useDiscordServers,
	useRefreshDiscordServerMembers,
	useUpdateDiscordRole,
} from '@/hooks/useDiscord'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { CreateDiscordRoleRequest, UpdateDiscordRoleRequest } from '@/lib/api'

export default function AdminDiscordServerRolesPage() {
	const { serverId } = useParams<{ serverId: string }>()
	usePageTitle('Admin - Discord Server Roles')
	const { data: discordServers, isLoading } = useDiscordServers()
	const createRole = useCreateDiscordRole()
	const updateRole = useUpdateDiscordRole()
	const deleteRole = useDeleteDiscordRole()
	const refreshMembers = useRefreshDiscordServerMembers()
	const { message, showSuccess, showError } = useMessage()

	const [createRoleDialogOpen, setCreateRoleDialogOpen] = useState(false)
	const [editRoleDialogOpen, setEditRoleDialogOpen] = useState(false)
	const [deleteRoleDialogOpen, setDeleteRoleDialogOpen] = useState(false)
	const [refreshing, setRefreshing] = useState(false)
	const [selectedRole, setSelectedRole] = useState<{
		roleId: string
		roleName: string
		description: string | null
		isActive: boolean
		autoApply: boolean
	} | null>(null)

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

	const server = useMemo(
		() => discordServers?.find((candidate) => candidate.id === serverId) ?? null,
		[discordServers, serverId]
	)

	const handleCreateRole = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!server || !roleFormData.roleId || !roleFormData.roleName) {
			showError('Role ID and name are required')
			return
		}

		try {
			await createRole.mutateAsync({ serverId: server.id, data: roleFormData })
			setCreateRoleDialogOpen(false)
			setRoleFormData({ roleId: '', roleName: '', description: '', autoApply: false })
			showSuccess('Role added successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to add role')
		}
	}

	const handleUpdateRole = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!server || !selectedRole) return

		try {
			await updateRole.mutateAsync({
				serverId: server.id,
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
		if (!server || !selectedRole) return
		try {
			await deleteRole.mutateAsync({ serverId: server.id, roleId: selectedRole.roleId })
			setDeleteRoleDialogOpen(false)
			setSelectedRole(null)
			showSuccess('Role deleted successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to delete role')
		}
	}

	const handleRefreshMembers = async () => {
		if (!server) return
		setRefreshing(true)
		try {
			const result = await refreshMembers.mutateAsync(server.id)
			showSuccess(
				`Refresh complete! Processed ${result.totalProcessed} users: ${result.successfulInvites} successful, ${result.failedInvites} failed`
			)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to refresh members')
		} finally {
			setRefreshing(false)
		}
	}

	if (isLoading) {
		return (
			<div className="flex justify-center py-12">
				<LoadingSpinner label="Loading Discord server..." />
			</div>
		)
	}

	if (!server) {
		return (
			<Card>
				<CardContent className="py-8">
					<p className="text-muted-foreground">Discord server not found.</p>
					<Button asChild variant="ghost" className="mt-3">
						<Link to="/admin/discord-servers">Back to Servers</Link>
					</Button>
				</CardContent>
			</Card>
		)
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-3">
				<div>
					<div className="text-sm text-muted-foreground">Discord / Servers / {server.guildName} / Roles</div>
					<h1 className="text-3xl font-bold gradient-text">Discord Server Roles</h1>
					<p className="text-muted-foreground mt-1">Manage role registry for this server</p>
				</div>
				<div className="flex items-center gap-2">
					<Button asChild variant="ghost">
						<Link to="/admin/discord-servers">
							<ArrowLeft className="h-4 w-4" />
							Back to Servers
						</Link>
					</Button>
					<Button variant="ghost" onClick={handleRefreshMembers} disabled={refreshing}>
						<RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
						Refresh All Members
					</Button>
					<Button variant="primary" onClick={() => setCreateRoleDialogOpen(true)}>
						<Plus className="h-4 w-4" />
						Add Role
					</Button>
				</div>
			</div>

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

			<Card variant="elevated">
				<CardHeader>
					<CardTitle>Roles</CardTitle>
					<CardDescription>Server: {server.guildName}</CardDescription>
				</CardHeader>
				<CardContent>
					{server.roles.length === 0 ? (
						<p className="text-sm text-muted-foreground">No roles configured.</p>
					) : (
						<div className="max-h-[65vh] overflow-y-auto pr-1">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Role Name</TableHead>
										<TableHead>Role ID</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Description</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{server.roles.map((role) => (
										<TableRow key={role.id}>
											<TableCell className="font-medium">{role.roleName}</TableCell>
											<TableCell className="font-mono text-xs text-muted-foreground">
												{role.roleId}
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-2">
													<span
														className={`text-xs ${role.isActive ? 'text-primary' : 'text-muted-foreground'}`}
													>
														{role.isActive ? 'Active' : 'Inactive'}
													</span>
													{role.autoApply && (
														<span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
															Auto-apply
														</span>
													)}
												</div>
											</TableCell>
											<TableCell className="max-w-md truncate text-sm text-muted-foreground">
												{role.description || '—'}
											</TableCell>
											<TableCell className="text-right">
												<div className="inline-flex gap-2">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => {
															setSelectedRole({
																roleId: role.id,
																roleName: role.roleName,
																description: role.description,
																isActive: role.isActive,
																autoApply: role.autoApply,
															})
															setRoleEditFormData({
																roleName: role.roleName,
																description: role.description || '',
																isActive: role.isActive,
																autoApply: role.autoApply,
															})
															setEditRoleDialogOpen(true)
														}}
													>
														<Edit className="h-4 w-4" />
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => {
															setSelectedRole({
																roleId: role.id,
																roleName: role.roleName,
																description: role.description,
																isActive: role.isActive,
																autoApply: role.autoApply,
															})
															setDeleteRoleDialogOpen(true)
														}}
													>
														<Trash2 className="h-4 w-4 text-destructive" />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>

			<Dialog open={createRoleDialogOpen} onOpenChange={setCreateRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add Role</DialogTitle>
						<DialogDescription>Add a new role to {server.guildName}</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleCreateRole} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="roleId">Role ID *</Label>
							<Input
								id="roleId"
								type="text"
								value={roleFormData.roleId}
								onChange={(e) => setRoleFormData({ ...roleFormData, roleId: e.target.value })}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="roleName">Role Name *</Label>
							<Input
								id="roleName"
								type="text"
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
								value={roleFormData.description}
								onChange={(e) => setRoleFormData({ ...roleFormData, description: e.target.value })}
							/>
						</div>
						<div className="flex items-center space-x-2">
							<Switch
								id="autoApply"
								checked={roleFormData.autoApply ?? false}
								onCheckedChange={(checked) => setRoleFormData({ ...roleFormData, autoApply: checked })}
							/>
							<Label htmlFor="autoApply" className="cursor-pointer">
								Auto-apply to all users
							</Label>
						</div>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setCreateRoleDialogOpen(false)}>
								Cancel
							</Button>
							<Button variant="confirm" type="submit" loading={createRole.isPending} loadingText="Adding...">
								Add Role
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

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
								onChange={(e) => setRoleEditFormData({ ...roleEditFormData, roleName: e.target.value })}
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
								id="edit-role-active"
								checked={roleEditFormData.isActive ?? true}
								onCheckedChange={(checked) => setRoleEditFormData({ ...roleEditFormData, isActive: checked })}
							/>
							<Label htmlFor="edit-role-active">Active</Label>
						</div>
						<div className="flex items-center space-x-2">
							<Switch
								id="edit-role-autoApply"
								checked={roleEditFormData.autoApply ?? false}
								onCheckedChange={(checked) =>
									setRoleEditFormData({ ...roleEditFormData, autoApply: checked })
								}
							/>
							<Label htmlFor="edit-role-autoApply">Auto-apply to all users</Label>
						</div>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setEditRoleDialogOpen(false)}>
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={updateRole.isPending}
								loadingText="Updating..."
							>
								Update Role
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={deleteRoleDialogOpen} onOpenChange={setDeleteRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Role</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete role "{selectedRole?.roleName}"?
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteRoleDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteRole}
							loading={deleteRole.isPending}
							loadingText="Deleting..."
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
