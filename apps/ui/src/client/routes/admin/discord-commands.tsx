import { Edit, FolderKanban, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Trans } from 'react-i18next'
import { Link } from 'react-router'

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
import { formatList, useAppTranslation } from '@/i18n'

import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type {
	CreateDiscordCommandRequest,
	DiscordCommand,
	UpdateDiscordCommandRequest,
} from '@/lib/api'

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
	const { t } = useAppTranslation()
	usePageTitle(t('admin.discord.commands.pageTitle'))
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
		{ value: '', label: t('admin.permissions.uncategorized') },
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
			{ value: 'all', label: t('groups.allCategories') },
			{ value: 'uncategorized', label: t('admin.permissions.uncategorized') },
			...categories.map((category) => ({ value: category.id, label: category.name })),
		],
		[categories, t]
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
			requiredPermissionIds: command.requiredPermissions.map(
				(permission) => permission.permissionId
			),
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
			showSuccess((t) => t('admin.discord.feedback.commandCreated'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.commandCreateError')
			)
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
			showSuccess((t) => t('admin.discord.feedback.commandUpdated'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.commandUpdateError')
			)
		}
	}

	const handleDeleteCommand = async () => {
		if (!selectedCommand) return
		try {
			await deleteCommand.mutateAsync(selectedCommand.id)
			setDeleteCommandOpen(false)
			resetCommandDialogState()
			showSuccess((t) => t('admin.discord.feedback.commandDeleted'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.commandDeleteError')
			)
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
					<h1 className="text-3xl font-bold gradient-text">{t('admin.discord.commands.title')}</h1>
					<p className="text-muted-foreground mt-1">{t('admin.discord.commands.description')}</p>
				</div>
				<div className="flex items-center gap-2">
					<Button asChild variant="ghost">
						<Link to="/admin/discord-commands/categories">
							<FolderKanban className="h-4 w-4" />
							{t('admin.nav.categories')}
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
						{t('admin.discord.commands.new')}
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
							<CardTitle>{t('admin.discord.commands.slashCommands')}</CardTitle>
							<CardDescription>{t('admin.discord.commands.attachmentsHint')}</CardDescription>
						</div>
						<div className="w-full md:w-72">
							<Label htmlFor="commands-category-filter" className="mb-1 block text-xs">
								{t('admin.discord.commands.filterCategory')}
							</Label>
							<Select
								inputId="commands-category-filter"
								value={commandsCategoryFilter}
								onValueChange={setCommandsCategoryFilter}
								options={commandsCategoryFilterOptions}
								placeholder={t('groups.allCategories')}
							/>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{commandsLoading ? (
						<p className="text-muted-foreground">{t('admin.discord.commands.loading')}</p>
					) : commands.length === 0 ? (
						<p className="text-muted-foreground">{t('admin.discord.commands.empty')}</p>
					) : filteredCommands.length === 0 ? (
						<p className="text-muted-foreground">{t('admin.discord.commands.noMatches')}</p>
					) : (
						<div className="space-y-4">
							{filteredCommands.map((command) => {
								const requiredPermissionNames = command.requiredPermissions.map((permission) => {
									return (
										permissionById.get(permission.permissionId)?.name ?? permission.permissionId
									)
								})
								const immutableAccessRequirements = command.immutableAccessRequirements ?? []

								return (
									<Card key={command.id} className="border border-border/70">
										<CardContent className="pt-4">
											<div className="flex items-start justify-between gap-4">
												<div className="space-y-2">
													<div className="flex items-center gap-2 flex-wrap">
														<h3 className="text-lg font-semibold">/{command.name}</h3>
														<Badge variant={command.isActive ? 'success' : 'secondary'}>
															{command.isActive
																? t('services.active')
																: t('admin.organizations.corp.inactive')}
														</Badge>
														<Badge variant="default">
															{command.commandType === 'programmatic'
																? t('admin.discord.commands.programmatic')
																: t('admin.discord.commands.staticResponse')}
														</Badge>
														{command.category && (
															<Badge variant="secondary">{command.category.name}</Badge>
														)}
													</div>
													<p className="text-sm text-muted-foreground">{command.description}</p>
													<div className="text-xs text-muted-foreground">
														{t('admin.discord.commands.permissions', {
															permissions:
																requiredPermissionNames.length > 0
																	? formatList(requiredPermissionNames)
																	: t('admin.users.discord.none'),
														})}
													</div>
													{immutableAccessRequirements.length > 0 && (
														<div className="text-xs text-muted-foreground">
															{t('admin.discord.commands.codeAccess', {
																requirements: formatList(immutableAccessRequirements),
															})}
														</div>
													)}
													<div className="text-xs text-muted-foreground">
														{t('admin.discord.commands.attachedServers', {
															count: command.serverAttachments.length,
														})}
													</div>
												</div>
												<div className="flex items-center gap-2">
													<Button
														variant="ghost"
														size="sm"
														aria-label={t('admin.discord.commands.editTitle')}
														onClick={() => openCommandEditDialog(command)}
													>
														<Edit className="h-4 w-4" />
													</Button>
													{command.commandType !== 'programmatic' && (
														<Button
															variant="destructive"
															size="sm"
															aria-label={t('admin.discord.commands.deleteTitle')}
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
						<DialogTitle>{t('admin.discord.commands.createTitle')}</DialogTitle>
						<DialogDescription>{t('admin.discord.commands.createDescription')}</DialogDescription>
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
							immutableAccessRequirements={selectedCommand?.immutableAccessRequirements ?? []}
						/>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setCreateCommandOpen(false)}>
								{t('common.cancel')}
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={createCommand.isPending}
								loadingText={t('admin.discord.shared.creating')}
							>
								{t('admin.discord.commands.create')}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={editCommandOpen} onOpenChange={setEditCommandOpen}>
				<DialogContent className="max-w-5xl">
					<DialogHeader>
						<DialogTitle>{t('admin.discord.commands.editTitle')}</DialogTitle>
						<DialogDescription>{t('admin.discord.commands.editDescription')}</DialogDescription>
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
							immutableAccessRequirements={selectedCommand?.immutableAccessRequirements ?? []}
						/>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setEditCommandOpen(false)}>
								{t('common.cancel')}
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={updateCommand.isPending}
								loadingText={t('admin.fields.saving')}
							>
								{t('groups.edit.save')}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={deleteCommandOpen} onOpenChange={setDeleteCommandOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.discord.commands.deleteTitle')}</DialogTitle>
						<DialogDescription>
							<Trans
								i18nKey="admin.discord.commands.deleteWarning"
								values={{ name: selectedCommand?.name }}
								components={{ name: <span className="font-semibold" /> }}
							/>
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteCommandOpen(false)}>
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteCommand}
							loading={deleteCommand.isPending}
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
	immutableAccessRequirements,
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
	immutableAccessRequirements: string[]
}) {
	const { t } = useAppTranslation()
	const availablePermissionOptions = permissionOptions.filter(
		(permission) => !commandForm.requiredPermissionIds.includes(permission.value)
	)

	const selectedPermissions = commandForm.requiredPermissionIds
		.map((permissionId) => permissionById.get(permissionId))
		.filter((permission): permission is NonNullable<typeof permission> => Boolean(permission))
	const hasImmutableAccessRequirements = immutableAccessRequirements.length > 0

	return (
		<div className="grid gap-4 md:grid-cols-2">
			<div className="space-y-4">
				<div>
					<Label htmlFor="command-name">{t('admin.discord.commands.name')}</Label>
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
					<p className="mt-1 text-xs text-muted-foreground">
						{t('admin.discord.commands.nameHint')}
					</p>
				</div>
				<div>
					<Label htmlFor="command-description">{t('groups.form.description')}</Label>
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
					<Label htmlFor="command-category">{t('myGroups.table.category')}</Label>
					<Select
						inputId="command-category"
						value={commandForm.categoryId}
						onValueChange={(value) =>
							setCommandForm((previous) => ({ ...previous, categoryId: value }))
						}
						options={categories}
						placeholder={t('admin.discord.commands.selectCategory')}
					/>
				</div>
				<div className="flex items-center gap-2">
					<Switch
						aria-label={t('services.active')}
						checked={commandForm.isActive}
						onCheckedChange={(checked) =>
							setCommandForm((previous) => ({ ...previous, isActive: checked }))
						}
					/>
					<span className="text-sm font-medium">{t('services.active')}</span>
				</div>
				<div className="space-y-2">
					<Label htmlFor="permission-select">{t('admin.discord.commands.requiredAccess')}</Label>
					{hasImmutableAccessRequirements ? (
						<div className="rounded-md border border-border/60 bg-muted/30 p-3">
							<div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
								{t('admin.discord.commands.staticAccess')}
							</div>
							<div className="flex flex-wrap gap-2">
								{immutableAccessRequirements.map((label) => (
									<Badge key={label} variant="secondary" className="px-2 py-1">
										{label}
									</Badge>
								))}
							</div>
						</div>
					) : (
						<>
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
												aria-label={t('admin.discord.commands.removePermission', {
													name: permission.name,
												})}
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
								placeholder={t('admin.discord.commands.addPermission')}
								emptyText={t('admin.discord.commands.noPermissions')}
								className="w-full"
								contentClassName="w-[min(90vw,36rem)]"
								inputClassName="h-9"
								getOptionSearchText={(option) =>
									`${option.label} ${option.urn} ${option.description ?? ''}`.trim()
								}
								renderOption={(option) => (
									<div className="space-y-0.5 py-0.5">
										<div className="text-sm font-medium">{option.label}</div>
										<div className="font-mono text-xs text-muted-foreground">{option.urn}</div>
									</div>
								)}
							/>
						</>
					)}
				</div>
			</div>

			<div className="space-y-4">
				{showResponseTemplate ? (
					<>
						<div>
							<Label htmlFor="command-response-template">
								{t('admin.discord.commands.responseTemplate')}
							</Label>
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
								{t('admin.discord.commands.variablesHint', { example: '{{discordUserId}}' })}
							</p>
						</div>
						<Card className="bg-muted/20">
							<CardHeader>
								<CardTitle className="text-base">{t('admin.discord.shared.preview')}</CardTitle>
								<CardDescription>{t('admin.discord.commands.previewDescription')}</CardDescription>
							</CardHeader>
							<CardContent className="break-words text-sm leading-relaxed">
								{commandForm.responseTemplate.trim().length > 0 ? (
									renderDiscordContentValue(commandForm.responseTemplate, 'discord-command-preview')
								) : (
									<span className="text-muted-foreground">
										{t('admin.discord.commands.noTemplate')}
									</span>
								)}
							</CardContent>
						</Card>
					</>
				) : (
					<Card className="bg-muted/20">
						<CardHeader>
							<CardTitle className="text-base">
								{t('admin.discord.commands.programmaticTitle')}
							</CardTitle>
							<CardDescription>
								{t('admin.discord.commands.programmaticDescription')}
							</CardDescription>
						</CardHeader>
					</Card>
				)}
			</div>
		</div>
	)
}
