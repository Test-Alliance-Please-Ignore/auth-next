import { Edit, MessageSquare, Plus, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Trans } from 'react-i18next'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { useAppTranslation } from '@/i18n'

import type { FormEvent } from 'react'
import type {
	CreateDiscordServerRequest,
	DiscordServerWithRoles,
	UpdateDiscordServerRequest,
} from '@/lib/api'

export default function AdminDiscordServersPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('admin.discord.servers.pageTitle'))
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

	const handleCreateServer = async (e: FormEvent) => {
		e.preventDefault()
		if (!serverFormData.guildId || !serverFormData.guildName) {
			showError((t) => t('admin.discord.feedback.serverRequired'))
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
			showSuccess((t) => t('admin.discord.feedback.serverAdded'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.serverAddError')
			)
		}
	}

	const handleUpdateServer = async (e: FormEvent) => {
		e.preventDefault()
		if (!selectedServer) return

		try {
			await updateServer.mutateAsync({
				serverId: selectedServer.id,
				data: serverEditFormData,
			})
			setEditServerDialogOpen(false)
			setSelectedServer(null)
			showSuccess((t) => t('admin.discord.feedback.serverUpdated'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.serverUpdateError')
			)
		}
	}

	const handleDeleteServer = async () => {
		if (!selectedServer) return

		try {
			await deleteServer.mutateAsync(selectedServer.id)
			setDeleteServerDialogOpen(false)
			setSelectedServer(null)
			showSuccess((t) => t('admin.discord.feedback.serverDeleted'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.serverDeleteError')
			)
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
				<LoadingSpinner label={t('admin.discord.shared.loadingServers')} />
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text flex items-center gap-2">
						<MessageSquare className="h-8 w-8 text-[hsl(var(--discord-blurple))]" />
						{t('admin.organizations.discord.servers')}
					</h1>
					<p className="text-muted-foreground mt-1">{t('admin.discord.servers.description')}</p>
				</div>
				<Button onClick={() => setCreateServerDialogOpen(true)}>
					<Plus className="h-4 w-4" />
					{t('admin.discord.servers.add')}
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
						<h3 className="mt-4 text-lg font-medium">{t('admin.discord.servers.empty')}</h3>
						<p className="text-muted-foreground mt-2">{t('admin.discord.servers.emptyHint')}</p>
						<Button onClick={() => setCreateServerDialogOpen(true)} className="mt-4">
							<Plus className="h-4 w-4" />
							{t('admin.discord.servers.add')}
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
												<span className="text-xs text-muted-foreground">
													{t('admin.discord.shared.inactiveBadge')}
												</span>
											)}
										</div>
										<div className="flex gap-1">
											<Button
												variant="ghost"
												size="sm"
												aria-label={t('admin.discord.servers.editTitle')}
												onClick={() => openEditServerDialog(server)}
											>
												<Edit className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label={t('admin.discord.servers.deleteTitle')}
												onClick={() => openDeleteServerDialog(server)}
											>
												<Trash2 className="h-4 w-4 text-destructive" />
											</Button>
										</div>
									</div>
									<p className="text-xs text-muted-foreground">
										{t('admin.discord.servers.guildId', { id: server.guildId })}
									</p>
									{server.description && (
										<p className="text-sm text-muted-foreground">{server.description}</p>
									)}
								</div>

								<div className="mt-auto space-y-2 pt-1">
									<div className="flex items-center justify-between gap-2">
										<div className="text-sm font-semibold text-foreground">
											<Trans
												i18nKey="admin.discord.servers.roleCount"
												values={{ count: server.roles?.length ?? 0 }}
												components={{ count: <span className="text-primary" /> }}
											/>
										</div>
										<Badge variant={server.manageNicknames ? 'success' : 'warning'}>
											{t(
												server.manageNicknames
													? 'admin.discord.servers.nicknamesEnabled'
													: 'admin.discord.servers.nicknamesDisabled'
											)}
										</Badge>
									</div>
									<div className="grid grid-cols-2 gap-2">
										<Button asChild variant="ghost" size="sm">
											<Link to={`/admin/discord-servers/${server.id}/roles`}>
												<Settings2 className="h-4 w-4" />
												{t('admin.breadcrumbs.roles')}
											</Link>
										</Button>
										<Button asChild variant="ghost" size="sm">
											<Link to={`/admin/discord-servers/${server.id}/commands`}>
												<MessageSquare className="h-4 w-4" />
												{t('admin.discord.shared.commands')}
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
						<DialogTitle>{t('admin.discord.servers.addTitle')}</DialogTitle>
						<DialogDescription>{t('admin.discord.servers.addDescription')}</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleCreateServer} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="guildId">{t('admin.discord.servers.guildIdRequired')}</Label>
							<Input
								id="guildId"
								type="text"
								placeholder={t('admin.discord.servers.idExample')}
								value={serverFormData.guildId}
								onChange={(e) => setServerFormData({ ...serverFormData, guildId: e.target.value })}
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="guildName">{t('admin.discord.servers.nameRequired')}</Label>
							<Input
								id="guildName"
								type="text"
								placeholder={t('admin.discord.servers.nameExample')}
								value={serverFormData.guildName}
								onChange={(e) =>
									setServerFormData({ ...serverFormData, guildName: e.target.value })
								}
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">{t('admin.discord.shared.descriptionOptional')}</Label>
							<Input
								id="description"
								type="text"
								placeholder={t('admin.discord.servers.descriptionPlaceholder')}
								value={serverFormData.description}
								onChange={(e) =>
									setServerFormData({ ...serverFormData, description: e.target.value })
								}
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
									{t('admin.discord.servers.manageNicknames')}
								</Label>
							</div>
						</div>

						<DialogFooter>
							<Button
								variant="cancel"
								type="button"
								onClick={() => setCreateServerDialogOpen(false)}
							>
								{t('common.cancel')}
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={createServer.isPending}
								loadingText={t('admin.organizations.corp.adding')}
							>
								{t('admin.discord.servers.add')}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={editServerDialogOpen} onOpenChange={setEditServerDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.discord.servers.editTitle')}</DialogTitle>
						<DialogDescription>{t('admin.discord.servers.editDescription')}</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleUpdateServer} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="edit-guildName">{t('admin.discord.servers.nameRequired')}</Label>
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
							<Label htmlFor="edit-description">
								{t('admin.discord.shared.descriptionOptional')}
							</Label>
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
								{t('services.active')}
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
								{t('admin.discord.servers.manageNicknames')}
							</Label>
						</div>

						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setEditServerDialogOpen(false)}>
								{t('common.cancel')}
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={updateServer.isPending}
								loadingText={t('hr.notes.updating')}
							>
								{t('admin.discord.servers.update')}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={deleteServerDialogOpen} onOpenChange={setDeleteServerDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.discord.servers.deleteTitle')}</DialogTitle>
						<DialogDescription>
							{t('admin.discord.servers.deleteWarning', { name: selectedServer?.guildName })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteServerDialogOpen(false)}>
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteServer}
							loading={deleteServer.isPending}
							loadingText={t('admin.users.account.deleting')}
						>
							{t('common.delete')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
