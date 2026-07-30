import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
	useDiscordServers,
	useResyncDiscordServerCommands,
} from '@/hooks/useDiscord'
import {
	useAttachDiscordCommandToServer,
	useDetachDiscordCommandFromServer,
	useDiscordCommands,
} from '@/hooks/useDiscordCommands'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { DiscordCommand } from '@/lib/api'

export default function AdminDiscordServerCommandsPage() {
	const { serverId } = useParams<{ serverId: string }>()
	usePageTitle('Admin - Discord Server Commands')
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

	const handleAttachCommand = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!server || !selectedCommandId) {
			showError('Select a command to attach')
			return
		}

		try {
			await attachCommandToServer.mutateAsync({
				commandId: selectedCommandId,
				data: { serverId: server.id },
			})
			setAddCommandDialogOpen(false)
			setSelectedCommandId('')
			showSuccess('Command attached to server')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to attach command')
		}
	}

	const handleDetachCommand = async (command: DiscordCommand) => {
		if (!server) return
		try {
			await detachCommandFromServer.mutateAsync({
				commandId: command.id,
				serverId: server.id,
			})
			showSuccess(`Detached /${command.name} from ${server.guildName}`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to detach command')
		}
	}

	const handleResyncCommands = async () => {
		if (!server) return
		setResyncing(true)
		try {
			const result = await resyncCommands.mutateAsync(server.id)
			showSuccess(
				`Command resync complete: ${result.synced}/${result.total} successful (${result.failed} failed)`
			)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to resync commands')
		} finally {
			setResyncing(false)
		}
	}

	if (serversLoading || commandsLoading) {
		return (
			<div className="flex justify-center py-12">
				<LoadingSpinner label="Loading Discord server commands..." />
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
					<div className="text-sm text-muted-foreground">
						Discord / Servers / {server.guildName} / Commands
					</div>
					<h1 className="text-3xl font-bold gradient-text">Discord Server Commands</h1>
					<p className="text-muted-foreground mt-1">Manage slash command attachments for this server</p>
				</div>
				<div className="flex items-center gap-2">
					<Button asChild variant="ghost">
						<Link to="/admin/discord-servers">
							<ArrowLeft className="h-4 w-4" />
							Back to Servers
						</Link>
					</Button>
					<Button variant="ghost" onClick={handleResyncCommands} disabled={resyncing}>
						<RefreshCw className={`h-4 w-4 ${resyncing ? 'animate-spin' : ''}`} />
						Resync Commands
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
						Add Command
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
					<CardTitle>Attached Commands</CardTitle>
					<CardDescription>Server: {server.guildName}</CardDescription>
				</CardHeader>
				<CardContent>
					{attachedCommands.length === 0 ? (
						<p className="text-sm text-muted-foreground">No commands attached to this server.</p>
					) : (
						<div className="overflow-x-auto rounded-lg border border-border/50">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Command</TableHead>
										<TableHead>Description</TableHead>
										<TableHead>Status</TableHead>
										<TableHead className="text-right">Actions</TableHead>
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
												{command.isActive ? 'Active' : 'Inactive'}
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleDetachCommand(command)}
													loading={detachCommandFromServer.isPending}
													loadingText="Detaching..."
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
						<DialogTitle>Add Command</DialogTitle>
						<DialogDescription>Attach a slash command to {server.guildName}</DialogDescription>
					</DialogHeader>
					<form className="space-y-4" onSubmit={handleAttachCommand}>
						<div className="space-y-2">
							<Label htmlFor="command-select">Command</Label>
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
								placeholder="Select command"
							/>
						</div>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setAddCommandDialogOpen(false)}>
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								disabled={!selectedCommandId}
								loading={attachCommandToServer.isPending}
								loadingText="Attaching..."
							>
								Attach Command
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	)
}
