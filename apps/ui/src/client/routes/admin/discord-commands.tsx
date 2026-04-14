import { Edit, FolderKanban, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { renderDiscordContentValue } from '@/components/discord-content-renderer'
import { Badge } from '@/components/ui/badge'
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
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
	useCreateDiscordCommand,
	useDeleteDiscordCommand,
	useDiscordCommandCategories,
	useDiscordCommands,
	useUpdateDiscordCommand,
} from '@/hooks/useDiscordCommands'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useGlobalPermissions } from '@/hooks/usePermissions'

import type {
	CreateDiscordCommandRequest,
	DiscordCommand,
	UpdateDiscordCommandRequest,
} from '@/lib/api'
import type { Dispatch, FormEvent, SetStateAction } from 'react'

interface CommandFormState {
	categoryId: string
	name: string
	description: string
	responseTemplate: string
	isActive: boolean
	requiredPermissionIds: string[]
}

function emptyCommandFormState(): CommandFormState {
	return {
		categoryId: '',
		name: '',
		description: '',
		responseTemplate: '',
		isActive: true,
		requiredPermissionIds: [],
	}
}

export default function AdminDiscordCommandsPage() {
	usePageTitle('Admin - Discord Commands')
	const { message, showSuccess, showError } = useMessage()

	const { data: categories = [] } = useDiscordCommandCategories()
	const { data: commands = [], isLoading: commandsLoading } = useDiscordCommands()
	const { data: globalPermissions = [] } = useGlobalPermissions()

	const createCommand = useCreateDiscordCommand()
	const updateCommand = useUpdateDiscordCommand()
	const deleteCommand = useDeleteDiscordCommand()

	const [createCommandOpen, setCreateCommandOpen] = useState(false)
	const [editCommandOpen, setEditCommandOpen] = useState(false)
	const [deleteCommandOpen, setDeleteCommandOpen] = useState(false)
	const [selectedCommand, setSelectedCommand] = useState<DiscordCommand | null>(null)
	const [commandForm, setCommandForm] = useState<CommandFormState>(emptyCommandFormState())
	const [permissionSearch, setPermissionSearch] = useState('')
	const [commandsCategoryFilter, setCommandsCategoryFilter] = useState<string>('all')

	const permissionById = useMemo(
		() => new Map(globalPermissions.map((permission) => [permission.id, permission])),
		[globalPermissions]
	)

	const categoryOptions = [
		{ value: '', label: 'Uncategorized' },
		...categories.map((category) => ({ value: category.id, label: category.name })),
	]

	const permissionOptions = useMemo(
		() =>
			globalPermissions.map((permission) => ({
				value: permission.id,
				label: permission.name,
				urn: permission.urn,
				description: permission.description ?? undefined,
			})),
		[globalPermissions]
	)

	const filteredCommands = useMemo(() => {
		if (commandsCategoryFilter === 'all') {
			return commands
		}
		if (commandsCategoryFilter === 'uncategorized') {
			return commands.filter((command) => !command.categoryId)
		}
		return commands.filter((command) => command.categoryId === commandsCategoryFilter)
	}, [commands, commandsCategoryFilter])

	const commandsCategoryFilterOptions = useMemo(
		() => [
			{ value: 'all', label: 'All categories' },
			{ value: 'uncategorized', label: 'Uncategorized' },
			...categories.map((category) => ({ value: category.id, label: category.name })),
		],
		[categories]
	)

	const resetCommandDialogState = () => {
		setSelectedCommand(null)
		setCommandForm(emptyCommandFormState())
		setPermissionSearch('')
	}

	const toCommandPayload = (
		state: CommandFormState,
		options?: { includeResponseTemplate?: boolean }
	): CreateDiscordCommandRequest | UpdateDiscordCommandRequest => {
		const includeResponseTemplate = options?.includeResponseTemplate ?? true
		return {
			categoryId: state.categoryId || null,
			name: state.name.trim().toLowerCase(),
			description: state.description.trim(),
			...(includeResponseTemplate ? { responseTemplate: state.responseTemplate.trim() } : {}),
			isActive: state.isActive,
			requiredPermissionIds: state.requiredPermissionIds,
		}
	}

	const openCommandEditDialog = (command: DiscordCommand) => {
		setSelectedCommand(command)
		setCommandForm({
			categoryId: command.categoryId ?? '',
			name: command.name,
			description: command.description,
			responseTemplate: command.responseTemplate ?? '',
			isActive: command.isActive,
			requiredPermissionIds: command.requiredPermissions.map((permission) => permission.permissionId),
		})
		setEditCommandOpen(true)
	}

	const openCommandDeleteDialog = (command: DiscordCommand) => {
		setSelectedCommand(command)
		setDeleteCommandOpen(true)
	}

	const handleCreateCommand = async (event: FormEvent) => {
		event.preventDefault()
		try {
			await createCommand.mutateAsync(toCommandPayload(commandForm) as CreateDiscordCommandRequest)
			setCreateCommandOpen(false)
			resetCommandDialogState()
			showSuccess('Discord slash command created')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to create slash command')
		}
	}

	const handleUpdateCommand = async (event: FormEvent) => {
		event.preventDefault()
		if (!selectedCommand) return
		try {
			await updateCommand.mutateAsync({
				id: selectedCommand.id,
				data: toCommandPayload(commandForm, {
					includeResponseTemplate: selectedCommand.commandType !== 'programmatic',
				}) as UpdateDiscordCommandRequest,
			})
			setEditCommandOpen(false)
			resetCommandDialogState()
			showSuccess('Discord slash command updated')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update slash command')
		}
	}

	const handleDeleteCommand = async () => {
		if (!selectedCommand) return
		try {
			await deleteCommand.mutateAsync(selectedCommand.id)
			setDeleteCommandOpen(false)
			resetCommandDialogState()
			showSuccess('Discord slash command deleted')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to delete slash command')
		}
	}

	const addRequiredPermission = (permissionId: string) => {
		setCommandForm((previous) => ({
			...previous,
			requiredPermissionIds: previous.requiredPermissionIds.includes(permissionId)
				? previous.requiredPermissionIds
				: [...previous.requiredPermissionIds, permissionId],
		}))
	}

	const removeRequiredPermission = (permissionId: string) => {
		setCommandForm((previous) => ({
			...previous,
			requiredPermissionIds: previous.requiredPermissionIds.filter((id) => id !== permissionId),
		}))
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Discord Commands</h1>
					<p className="text-muted-foreground mt-1">
						Manage slash commands, permissions, and response templates
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button asChild variant="ghost">
						<Link to="/admin/discord-commands/categories">
							<FolderKanban className="h-4 w-4" />
							Categories
						</Link>
					</Button>
					<Button
						variant="primary"
						onClick={() => {
							resetCommandDialogState()
							setCreateCommandOpen(true)
						}}
					>
						<Plus className="h-4 w-4" />
						New Command
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
					<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
						<div>
							<CardTitle>Slash Commands</CardTitle>
							<CardDescription>
								Server attachments are managed from the Discord Servers page
							</CardDescription>
						</div>
						<div className="w-full md:w-72">
							<Label htmlFor="commands-category-filter" className="mb-1 block text-xs">
								Filter by category
							</Label>
							<Select
								inputId="commands-category-filter"
								value={commandsCategoryFilter}
								onValueChange={setCommandsCategoryFilter}
								options={commandsCategoryFilterOptions}
								placeholder="All categories"
							/>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{commandsLoading ? (
						<p className="text-muted-foreground">Loading commands...</p>
					) : commands.length === 0 ? (
						<p className="text-muted-foreground">No commands defined yet.</p>
					) : filteredCommands.length === 0 ? (
						<p className="text-muted-foreground">No commands match this category filter.</p>
					) : (
						<div className="space-y-4">
							{filteredCommands.map((command) => {
								const requiredPermissionNames = command.requiredPermissions.map((permission) => {
									return permissionById.get(permission.permissionId)?.name ?? permission.permissionId
								})

								return (
									<Card key={command.id} className="border border-border/70">
										<CardContent className="pt-4">
											<div className="flex items-start justify-between gap-4">
												<div className="space-y-2">
													<div className="flex items-center gap-2 flex-wrap">
														<h3 className="text-lg font-semibold">/{command.name}</h3>
														<Badge variant={command.isActive ? 'success' : 'secondary'}>
															{command.isActive ? 'Active' : 'Inactive'}
														</Badge>
														<Badge variant="default">
															{command.commandType === 'programmatic'
																? 'Programmatic'
																: 'Static Response'}
														</Badge>
														{command.category && (
															<Badge variant="secondary">{command.category.name}</Badge>
														)}
													</div>
													<p className="text-sm text-muted-foreground">{command.description}</p>
													<div className="text-xs text-muted-foreground">
														Required permissions:{' '}
														{requiredPermissionNames.length > 0
															? requiredPermissionNames.join(', ')
															: 'None'}
													</div>
												<div className="text-xs text-muted-foreground">
													Attached servers: {command.serverAttachments.length}
												</div>
											</div>
											<div className="flex items-center gap-2">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => openCommandEditDialog(command)}
												>
													<Edit className="h-4 w-4" />
												</Button>
												{command.commandType !== 'programmatic' && (
													<Button
														variant="destructive"
														size="sm"
														onClick={() => openCommandDeleteDialog(command)}
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												)}
											</div>
										</div>
									</CardContent>
								</Card>
								)
							})}
						</div>
					)}
				</CardContent>
			</Card>

			<Dialog open={createCommandOpen} onOpenChange={setCreateCommandOpen}>
				<DialogContent className="max-w-5xl">
					<DialogHeader>
						<DialogTitle>Create Slash Command</DialogTitle>
						<DialogDescription>Define command metadata, permissions, and response markdown</DialogDescription>
					</DialogHeader>
					<form className="space-y-4" onSubmit={handleCreateCommand}>
						<CommandFormFields
							categories={categoryOptions}
							commandForm={commandForm}
							setCommandForm={setCommandForm}
							showResponseTemplate
							disableNameEdit={false}
							permissionOptions={permissionOptions}
							permissionById={permissionById}
							permissionSearch={permissionSearch}
							setPermissionSearch={setPermissionSearch}
							onAddRequiredPermission={addRequiredPermission}
							onRemoveRequiredPermission={removeRequiredPermission}
							/>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setCreateCommandOpen(false)}>
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={createCommand.isPending}
								loadingText="Creating..."
							>
								Create Command
							</Button>
						</DialogFooter>
					</form>
					</DialogContent>
				</Dialog>

			<Dialog open={editCommandOpen} onOpenChange={setEditCommandOpen}>
				<DialogContent className="max-w-5xl">
					<DialogHeader>
						<DialogTitle>Edit Slash Command</DialogTitle>
						<DialogDescription>Update command metadata and response behavior</DialogDescription>
					</DialogHeader>
					<form className="space-y-4" onSubmit={handleUpdateCommand}>
						<CommandFormFields
							categories={categoryOptions}
							commandForm={commandForm}
							setCommandForm={setCommandForm}
							showResponseTemplate={selectedCommand?.commandType !== 'programmatic'}
							disableNameEdit={selectedCommand?.commandType === 'programmatic'}
							permissionOptions={permissionOptions}
							permissionById={permissionById}
							permissionSearch={permissionSearch}
							setPermissionSearch={setPermissionSearch}
							onAddRequiredPermission={addRequiredPermission}
							onRemoveRequiredPermission={removeRequiredPermission}
							/>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setEditCommandOpen(false)}>
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={updateCommand.isPending}
								loadingText="Saving..."
							>
								Save Changes
							</Button>
						</DialogFooter>
					</form>
					</DialogContent>
				</Dialog>

			<Dialog open={deleteCommandOpen} onOpenChange={setDeleteCommandOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Slash Command</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete{' '}
							<span className="font-semibold">/{selectedCommand?.name}</span>?
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteCommandOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteCommand}
							loading={deleteCommand.isPending}
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

function CommandFormFields({
	categories,
	commandForm,
	setCommandForm,
	showResponseTemplate,
	disableNameEdit,
	permissionOptions,
	permissionById,
	permissionSearch,
	setPermissionSearch,
	onAddRequiredPermission,
	onRemoveRequiredPermission,
}: {
	categories: Array<{ value: string; label: string }>
	commandForm: CommandFormState
	setCommandForm: Dispatch<SetStateAction<CommandFormState>>
	showResponseTemplate?: boolean
	disableNameEdit?: boolean
	permissionOptions: Array<{
		value: string
		label: string
		urn: string
		description?: string
	}>
	permissionById: Map<
		string,
		{
			id: string
			name: string
			urn: string
			description: string | null
		}
	>
	permissionSearch: string
	setPermissionSearch: Dispatch<SetStateAction<string>>
	onAddRequiredPermission: (permissionId: string) => void
	onRemoveRequiredPermission: (permissionId: string) => void
}) {
	const availablePermissionOptions = permissionOptions.filter(
		(permission) => !commandForm.requiredPermissionIds.includes(permission.value)
	)

	const selectedPermissions = commandForm.requiredPermissionIds
		.map((permissionId) => permissionById.get(permissionId))
		.filter((permission): permission is NonNullable<typeof permission> => Boolean(permission))

	return (
		<div className="grid gap-4 md:grid-cols-2">
				<div className="space-y-4">
					<div>
						<Label htmlFor="command-name">Command Name</Label>
						<Input
							id="command-name"
							value={commandForm.name}
							onChange={(event) =>
								setCommandForm((previous) => ({ ...previous, name: event.target.value }))
							}
							placeholder="example_command"
							disabled={disableNameEdit}
							required
						/>
						<p className="mt-1 text-xs text-muted-foreground">lowercase letters, numbers, `_` or `-`</p>
					</div>
				<div>
					<Label htmlFor="command-description">Description</Label>
					<Input
						id="command-description"
						value={commandForm.description}
						onChange={(event) =>
							setCommandForm((previous) => ({ ...previous, description: event.target.value }))
						}
						maxLength={100}
						required
					/>
				</div>
				<div>
					<Label htmlFor="command-category">Category</Label>
					<Select
						inputId="command-category"
						value={commandForm.categoryId}
						onValueChange={(value) =>
							setCommandForm((previous) => ({ ...previous, categoryId: value }))
						}
						options={categories}
						placeholder="Select category"
					/>
				</div>
				<div className="flex items-center gap-2">
					<Switch
						checked={commandForm.isActive}
						onCheckedChange={(checked) =>
							setCommandForm((previous) => ({ ...previous, isActive: checked }))
						}
					/>
					<span className="text-sm font-medium">Active</span>
				</div>
				<div className="space-y-2">
					<Label htmlFor="permission-select">Required Global Permissions</Label>
					{selectedPermissions.length > 0 && (
						<div className="flex flex-wrap gap-2">
							{selectedPermissions.map((permission) => (
								<div
									key={permission.id}
									className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-sm"
								>
									<span>{permission.name}</span>
									<button
										type="button"
										onClick={() => onRemoveRequiredPermission(permission.id)}
										className="ml-1 hover:text-destructive"
										aria-label={`Remove ${permission.name}`}
									>
										<X className="h-3 w-3" />
									</button>
								</div>
							))}
						</div>
					)}
					<Select<{ value: string; label: string; urn: string; description?: string }>
						inputId="permission-select"
						value=""
						onValueChange={(nextPermissionId) => {
							if (!nextPermissionId) return
							onAddRequiredPermission(nextPermissionId)
							setPermissionSearch('')
						}}
						query={permissionSearch}
						onQueryChange={setPermissionSearch}
						searchable
						options={availablePermissionOptions}
						placeholder="Add permission..."
						emptyText="No matching permissions found"
						className="w-full"
						contentClassName="w-[min(90vw,36rem)]"
						inputClassName="h-9"
						getOptionSearchText={(option) => `${option.label} ${option.urn} ${option.description ?? ''}`.trim()}
						renderOption={(option) => (
							<div className="space-y-0.5 py-0.5">
								<div className="text-sm font-medium">{option.label}</div>
								<div className="font-mono text-xs text-muted-foreground">{option.urn}</div>
							</div>
						)}
					/>
				</div>
			</div>

			<div className="space-y-4">
				{showResponseTemplate ? (
					<>
						<div>
							<Label htmlFor="command-response-template">Response Template (Discord Markdown)</Label>
							<Textarea
								id="command-response-template"
								value={commandForm.responseTemplate}
								onChange={(event) =>
									setCommandForm((previous) => ({
										...previous,
										responseTemplate: event.target.value,
									}))
								}
								rows={12}
								maxLength={2000}
								required
							/>
							<p className="mt-1 text-xs text-muted-foreground">
								Supports template variables like {'{{discordUserId}}'} and command option names.
							</p>
						</div>
						<Card className="bg-muted/20">
							<CardHeader>
								<CardTitle className="text-base">Preview</CardTitle>
								<CardDescription>Rendered markdown preview of the response template</CardDescription>
							</CardHeader>
							<CardContent className="break-words text-sm leading-relaxed">
								{commandForm.responseTemplate.trim().length > 0 ? (
									renderDiscordContentValue(commandForm.responseTemplate, 'discord-command-preview')
								) : (
									<span className="text-muted-foreground">No response template yet.</span>
								)}
							</CardContent>
						</Card>
					</>
				) : (
					<Card className="bg-muted/20">
						<CardHeader>
							<CardTitle className="text-base">Programmatic Command</CardTitle>
							<CardDescription>
								Response content is generated by the command handler in code.
							</CardDescription>
						</CardHeader>
					</Card>
				)}
			</div>
		</div>
	)
}
