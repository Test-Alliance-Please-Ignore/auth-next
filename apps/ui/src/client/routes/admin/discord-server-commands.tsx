import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'

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
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useDiscordServers, useResyncDiscordServerCommands } from '@/hooks/useDiscord'
import {
	useAttachDiscordCommandToServer,
	useDetachDiscordCommandFromServer,
	useDiscordCommands,
} from '@/hooks/useDiscordCommands'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'

import type { FormEvent } from 'react'
import type { DiscordCommand } from '@/lib/api'

export default function AdminDiscordServerCommandsPage() {
	const { t } = useAppTranslation()
	const { serverId } = useParams<{ serverId: string }>()
	usePageTitle(t('admin.discord.serverCommands.pageTitle'))
	const { data: discordServers, isLoading: serversLoading } = useDiscordServers()
	const { data: discordCommands = [], isLoading: commandsLoading } = useDiscordCommands()
	const resyncCommands = useResyncDiscordServerCommands()
	const attachCommandToServer = useAttachDiscordCommandToServer()
	const detachCommandFromServer = useDetachDiscordCommandFromServer()
	const { message, showSuccess, showError } = useMessage()

	const [addCommandDialogOpen, setAddCommandDialogOpen] = useState(false)
	const [selectedCommandId, setSelectedCommandId] = useState('')
	const [resyncing, setResyncing] = useState(false)

	const server = useMemo(
		() => discordServers?.find((candidate) => candidate.id === serverId) ?? null,
		[discordServers, serverId]
	)

	const attachedCommands = useMemo(
		() =>
			server
				? discordCommands.filter((command) =>
						command.serverAttachments.some((attachment) => attachment.discordServerId === server.id)
					)
				: [],
		[discordCommands, server]
	)

	const availableCommands = useMemo(() => {
		const attachedIds = new Set(attachedCommands.map((command) => command.id))
		return discordCommands.filter((command) => !attachedIds.has(command.id))
	}, [attachedCommands, discordCommands])

	const handleAttachCommand = async (e: FormEvent) => {
		e.preventDefault()
		if (!server || !selectedCommandId) {
			showError((t) => t('admin.discord.feedback.selectCommand'))
			return
		}

		try {
			await attachCommandToServer.mutateAsync({
				commandId: selectedCommandId,
				data: { serverId: server.id },
			})
			setAddCommandDialogOpen(false)
			setSelectedCommandId('')
			showSuccess((t) => t('admin.discord.feedback.commandAttached'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.commandAttachError')
			)
		}
	}

	const handleDetachCommand = async (command: DiscordCommand) => {
		if (!server) return
		try {
			await detachCommandFromServer.mutateAsync({
				commandId: command.id,
				serverId: server.id,
			})
			showSuccess((t) =>
				t('admin.discord.feedback.commandDetached', {
					command: command.name,
					server: server.guildName,
				})
			)
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.commandDetachError')
			)
		}
	}

	const handleResyncCommands = async () => {
		if (!server) return
		setResyncing(true)
		try {
			const result = await resyncCommands.mutateAsync(server.id)
			showSuccess((t) =>
				t('admin.discord.feedback.commandsResynced', {
					synced: result.synced,
					total: result.total,
					failed: result.failed,
				})
			)
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.commandResyncError')
			)
		} finally {
			setResyncing(false)
		}
	}

	if (serversLoading || commandsLoading) {
		return (
			<div className="flex justify-center py-12">
				<LoadingSpinner label={t('admin.discord.shared.loadingServerCommands')} />
			</div>
		)
	}

	if (!server) {
		return (
			<Card>
				<CardContent className="py-8">
					<p className="text-muted-foreground">{t('admin.discord.shared.serverNotFound')}</p>
					<Button asChild variant="ghost" className="mt-3">
						<Link to="/admin/discord-servers">{t('admin.discord.shared.backServers')}</Link>
					</Button>
				</CardContent>
			</Card>
		)
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-3">
				<div>
					<div className="text-sm text-muted-foreground">
						{t('admin.discord.serverCommands.breadcrumb', { name: server.guildName })}
					</div>
					<h1 className="text-3xl font-bold gradient-text">
						{t('admin.discord.serverCommands.title')}
					</h1>
					<p className="text-muted-foreground mt-1">
						{t('admin.discord.serverCommands.description')}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button asChild variant="ghost">
						<Link to="/admin/discord-servers">
							<ArrowLeft className="h-4 w-4" />
							{t('admin.discord.shared.backServers')}
						</Link>
					</Button>
					<Button variant="ghost" onClick={handleResyncCommands} disabled={resyncing}>
						<RefreshCw className={`h-4 w-4 ${resyncing ? 'animate-spin' : ''}`} />
						{t('admin.discord.serverCommands.resync')}
					</Button>
					<Button
						variant="primary"
						onClick={() => {
							setSelectedCommandId('')
							setAddCommandDialogOpen(true)
						}}
						disabled={availableCommands.length === 0}
					>
						<Plus className="h-4 w-4" />
						{t('admin.discord.serverCommands.add')}
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
					<CardTitle>{t('admin.discord.serverCommands.attached')}</CardTitle>
					<CardDescription>
						{t('admin.discord.shared.serverName', { name: server.guildName })}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{attachedCommands.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t('admin.discord.serverCommands.empty')}
						</p>
					) : (
						<div className="overflow-x-auto rounded-lg border border-border/50">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t('admin.discord.serverCommands.command')}</TableHead>
										<TableHead>{t('groups.form.description')}</TableHead>
										<TableHead>{t('admin.users.account.status')}</TableHead>
										<TableHead className="text-right">{t('myGroups.table.actions')}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{attachedCommands.map((command) => (
										<TableRow key={command.id}>
											<TableCell className="font-medium">/{command.name}</TableCell>
											<TableCell className="max-w-[36rem] truncate text-sm text-muted-foreground">
												{command.description}
											</TableCell>
											<TableCell className="text-sm">
												{command.isActive
													? t('services.active')
													: t('admin.organizations.corp.inactive')}
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="ghost"
													size="sm"
													aria-label={t('admin.discord.commands.removePermission', {
														name: `/${command.name}`,
													})}
													onClick={() => handleDetachCommand(command)}
													loading={detachCommandFromServer.isPending}
													loadingText={t('admin.discord.shared.detaching')}
												>
													<Trash2 className="h-4 w-4 text-destructive" />
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>

			<Dialog open={addCommandDialogOpen} onOpenChange={setAddCommandDialogOpen}>
				<DialogContent onOpenAutoFocus={(event) => event.preventDefault()}>
					<DialogHeader>
						<DialogTitle>{t('admin.discord.serverCommands.add')}</DialogTitle>
						<DialogDescription>
							{t('admin.discord.serverCommands.attachDescription', { name: server.guildName })}
						</DialogDescription>
					</DialogHeader>
					<form className="space-y-4" onSubmit={handleAttachCommand}>
						<div className="space-y-2">
							<Label htmlFor="command-select">{t('admin.discord.serverCommands.command')}</Label>
							<Select
								inputId="command-select"
								value={selectedCommandId}
								onValueChange={setSelectedCommandId}
								options={availableCommands.map((command) => ({
									value: command.id,
									label: `/${command.name}`,
									description: command.description,
								}))}
								searchable
								placeholder={t('admin.discord.serverCommands.select')}
							/>
						</div>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setAddCommandDialogOpen(false)}>
								{t('common.cancel')}
							</Button>
							<Button
								variant="confirm"
								type="submit"
								disabled={!selectedCommandId}
								loading={attachCommandToServer.isPending}
								loadingText={t('admin.permissionAttachment.attaching')}
							>
								{t('admin.discord.serverCommands.attach')}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	)
}
