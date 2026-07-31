import { Edit, MessageSquare, Plus, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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
	useCreateDiscordServer,
	useDeleteDiscordServer,
	useDiscordServers,
	useUpdateDiscordServer,
} from '@/hooks/useDiscord'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { CreateDiscordServerRequest, DiscordServerWithRoles, UpdateDiscordServerRequest } from '@/lib/api'

export default function AdminDiscordServersPage() {
	usePageTitle('Admin - Discord Servers')
	const { data: discordServers, isLoading } = useDiscordServers()
	const createServer = useCreateDiscordServer()
	const updateServer = useUpdateDiscordServer()
	const deleteServer = useDeleteDiscordServer()
	const { message, showSuccess, showError } = useMessage()

	const [createServerDialogOpen, setCreateServerDialogOpen] = useState(false)
	const [editServerDialogOpen, setEditServerDialogOpen] = useState(false)
	const [deleteServerDialogOpen, setDeleteServerDialogOpen] = useState(false)
	const [selectedServer, setSelectedServer] = useState<DiscordServerWithRoles | null>(null)

	const [serverFormData, setServerFormData] = useState<CreateDiscordServerRequest>({
		guildId: '',
		guildName: '',
		description: '',
		manageNicknames: false,
	})

	const [serverEditFormData, setServerEditFormData] = useState<UpdateDiscordServerRequest>({
		guildName: '',
		description: '',
		isActive: true,
		manageNicknames: false,
	})

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
				manageNicknames: false,
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
			manageNicknames: server.manageNicknames ?? false,
		})
		setEditServerDialogOpen(true)
	}

	const openDeleteServerDialog = (server: DiscordServerWithRoles) => {
		setSelectedServer(server)
		setDeleteServerDialogOpen(true)
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
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text flex items-center gap-2">
						<MessageSquare className="h-8 w-8 text-[hsl(var(--discord-blurple))]" />
						Discord Servers
					</h1>
					<p className="text-muted-foreground mt-1">
						Manage the server registry. Roles and commands are managed per server.
					</p>
				</div>
				<Button onClick={() => setCreateServerDialogOpen(true)}>
					<Plus className="h-4 w-4" />
					Add Server
				</Button>
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

			{!discordServers || discordServers.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
						<h3 className="mt-4 text-lg font-medium">No Discord servers</h3>
						<p className="text-muted-foreground mt-2">
							Add a Discord server to the registry to get started.
						</p>
						<Button onClick={() => setCreateServerDialogOpen(true)} className="mt-4">
							<Plus className="h-4 w-4" />
							Add Server
						</Button>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{discordServers.map((server) => (
						<Card key={server.id} className="flex h-full flex-col border border-border/70">
							<CardContent className="flex h-full flex-col gap-4 pt-4">
								<div className="space-y-1">
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2">
											<h3 className="font-semibold">{server.guildName}</h3>
											{!server.isActive && (
												<span className="text-xs text-muted-foreground">(Inactive)</span>
											)}
										</div>
										<div className="flex gap-1">
											<Button
												variant="ghost"
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
									<p className="text-xs text-muted-foreground">Guild ID: {server.guildId}</p>
									{server.description && (
										<p className="text-sm text-muted-foreground">{server.description}</p>
									)}
								</div>

								<div className="mt-auto space-y-2 pt-1">
									<div className="flex items-center justify-between gap-2">
										<div className="text-sm font-semibold text-foreground">
											Roles: <span className="text-primary">{server.roles?.length ?? 0}</span>
										</div>
										<Badge variant={server.manageNicknames ? 'success' : 'warning'}>
											Nicknames {server.manageNicknames ? 'Enabled' : 'Disabled'}
										</Badge>
									</div>
									<div className="grid grid-cols-2 gap-2">
									<Button asChild variant="ghost" size="sm">
										<Link to={`/admin/discord-servers/${server.id}/roles`}>
											<Settings2 className="h-4 w-4" />
											Roles
										</Link>
									</Button>
									<Button asChild variant="ghost" size="sm">
										<Link to={`/admin/discord-servers/${server.id}/commands`}>
											<MessageSquare className="h-4 w-4" />
											Commands
										</Link>
									</Button>
									</div>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

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
						</div>

						<div className="space-y-2">
							<Label htmlFor="guildName">Server Name *</Label>
							<Input
								id="guildName"
								type="text"
								placeholder="e.g., My Discord Server"
								value={serverFormData.guildName}
								onChange={(e) => setServerFormData({ ...serverFormData, guildName: e.target.value })}
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
								onChange={(e) => setServerFormData({ ...serverFormData, description: e.target.value })}
							/>
						</div>

						<div className="flex items-center space-x-2">
							<Switch
								id="manageNicknames"
								checked={serverFormData.manageNicknames ?? false}
								onCheckedChange={(checked) =>
									setServerFormData({ ...serverFormData, manageNicknames: checked })
								}
							/>
							<div className="flex-1">
								<Label htmlFor="manageNicknames" className="cursor-pointer">
									Manage Nicknames
								</Label>
							</div>
						</div>

						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setCreateServerDialogOpen(false)}>
								Cancel
							</Button>
							<Button variant="confirm" type="submit" loading={createServer.isPending} loadingText="Adding...">
								Add Server
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

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
								onChange={(e) => setServerEditFormData({ ...serverEditFormData, guildName: e.target.value })}
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

						<div className="flex items-center space-x-2">
							<Switch
								id="edit-manageNicknames"
								checked={serverEditFormData.manageNicknames ?? false}
								onCheckedChange={(checked) =>
									setServerEditFormData({ ...serverEditFormData, manageNicknames: checked })
								}
							/>
							<Label htmlFor="edit-manageNicknames" className="cursor-pointer">
								Manage Nicknames
							</Label>
						</div>

						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setEditServerDialogOpen(false)}>
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={updateServer.isPending}
								loadingText="Updating..."
							>
								Update Server
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={deleteServerDialogOpen} onOpenChange={setDeleteServerDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Discord Server</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "{selectedServer?.guildName}"? This will remove all
							associated roles and command attachments.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteServerDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteServer}
							loading={deleteServer.isPending}
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
