import { ArrowLeft, Edit, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Trans } from 'react-i18next'
import { Link } from 'react-router'

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
import { Textarea } from '@/components/ui/textarea'
import {
	useCreateDiscordCommandCategory,
	useDeleteDiscordCommandCategory,
	useDiscordCommandCategories,
	useUpdateDiscordCommandCategory,
} from '@/hooks/useDiscordCommands'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'

import type { FormEvent } from 'react'
import type {
	CreateDiscordCommandCategoryRequest,
	DiscordCommandCategory,
	UpdateDiscordCommandCategoryRequest,
} from '@/lib/api'

interface CategoryFormState {
	name: string
	description: string
	sortOrder: string
}

function emptyCategoryFormState(): CategoryFormState {
	return {
		name: '',
		description: '',
		sortOrder: '0',
	}
}

export default function AdminDiscordCommandCategoriesPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('admin.discord.categories.pageTitle'))
	const { message, showSuccess, showError } = useMessage()

	const { data: categories = [], isLoading: categoriesLoading } = useDiscordCommandCategories()
	const createCategory = useCreateDiscordCommandCategory()
	const updateCategory = useUpdateDiscordCommandCategory()
	const deleteCategory = useDeleteDiscordCommandCategory()

	const [createCategoryOpen, setCreateCategoryOpen] = useState(false)
	const [editCategoryOpen, setEditCategoryOpen] = useState(false)
	const [deleteCategoryOpen, setDeleteCategoryOpen] = useState(false)
	const [selectedCategory, setSelectedCategory] = useState<DiscordCommandCategory | null>(null)
	const [categoryForm, setCategoryForm] = useState<CategoryFormState>(emptyCategoryFormState())

	const resetCategoryDialogState = () => {
		setSelectedCategory(null)
		setCategoryForm(emptyCategoryFormState())
	}

	const toCategoryPayload = (
		state: CategoryFormState
	): CreateDiscordCommandCategoryRequest | UpdateDiscordCommandCategoryRequest => ({
		name: state.name.trim(),
		description: state.description.trim() || undefined,
		sortOrder: Number.parseInt(state.sortOrder, 10) || 0,
	})

	const openCategoryEditDialog = (category: DiscordCommandCategory) => {
		setSelectedCategory(category)
		setCategoryForm({
			name: category.name,
			description: category.description ?? '',
			sortOrder: String(category.sortOrder),
		})
		setEditCategoryOpen(true)
	}

	const openCategoryDeleteDialog = (category: DiscordCommandCategory) => {
		setSelectedCategory(category)
		setDeleteCategoryOpen(true)
	}

	const handleCreateCategory = async (event: FormEvent) => {
		event.preventDefault()
		try {
			await createCategory.mutateAsync(
				toCategoryPayload(categoryForm) as CreateDiscordCommandCategoryRequest
			)
			setCreateCategoryOpen(false)
			resetCategoryDialogState()
			showSuccess((t) => t('admin.discord.feedback.categoryCreated'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.categoryCreateError')
			)
		}
	}

	const handleUpdateCategory = async (event: FormEvent) => {
		event.preventDefault()
		if (!selectedCategory) return

		try {
			await updateCategory.mutateAsync({
				id: selectedCategory.id,
				data: toCategoryPayload(categoryForm) as UpdateDiscordCommandCategoryRequest,
			})
			setEditCategoryOpen(false)
			resetCategoryDialogState()
			showSuccess((t) => t('admin.discord.feedback.categoryUpdated'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.categoryUpdateError')
			)
		}
	}

	const handleDeleteCategory = async () => {
		if (!selectedCategory) return
		try {
			await deleteCategory.mutateAsync(selectedCategory.id)
			setDeleteCategoryOpen(false)
			resetCategoryDialogState()
			showSuccess((t) => t('admin.discord.feedback.categoryDeleted'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.discord.feedback.categoryDeleteError')
			)
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-3">
				<div>
					<div className="text-sm text-muted-foreground">
						{t('admin.discord.categories.breadcrumb')}
					</div>
					<h1 className="text-3xl font-bold gradient-text">
						{t('admin.discord.categories.title')}
					</h1>
					<p className="text-muted-foreground mt-1">{t('admin.discord.categories.description')}</p>
				</div>
				<div className="flex items-center gap-2">
					<Button asChild variant="ghost">
						<Link to="/admin/discord-commands">
							<ArrowLeft className="h-4 w-4" />
							{t('admin.discord.categories.backCommands')}
						</Link>
					</Button>
					<Button
						variant="primary"
						onClick={() => {
							resetCategoryDialogState()
							setCreateCategoryOpen(true)
						}}
					>
						<Plus className="h-4 w-4" />
						{t('admin.permissionCategories.new')}
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
					<CardTitle>{t('admin.nav.categories')}</CardTitle>
					<CardDescription>{t('admin.discord.categories.usageHint')}</CardDescription>
				</CardHeader>
				<CardContent>
					{categoriesLoading ? (
						<p className="text-muted-foreground">{t('admin.discord.shared.loadingCategories')}</p>
					) : categories.length === 0 ? (
						<p className="text-muted-foreground">{t('admin.discord.categories.empty')}</p>
					) : (
						<div className="space-y-2">
							{categories
								.slice()
								.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
								.map((category) => (
									<div
										key={category.id}
										className="flex items-start justify-between rounded-md border p-3"
									>
										<div className="space-y-1">
											<div className="flex items-center gap-2">
												<span className="font-medium">{category.name}</span>
												<Badge variant="secondary">
													{t('admin.discord.categories.order', { order: category.sortOrder })}
												</Badge>
											</div>
											{category.description && (
												<p className="text-sm text-muted-foreground">{category.description}</p>
											)}
										</div>
										<div className="flex items-center gap-2">
											<Button
												variant="ghost"
												size="sm"
												aria-label={t('admin.discord.categories.editTitle')}
												onClick={() => openCategoryEditDialog(category)}
											>
												<Edit className="h-4 w-4" />
											</Button>
											<Button
												variant="destructive"
												size="sm"
												aria-label={t('admin.permissionCategories.delete')}
												onClick={() => openCategoryDeleteDialog(category)}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
									</div>
								))}
						</div>
					)}
				</CardContent>
			</Card>

			<Dialog open={createCategoryOpen} onOpenChange={setCreateCategoryOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.discord.categories.createTitle')}</DialogTitle>
						<DialogDescription>{t('admin.discord.categories.createDescription')}</DialogDescription>
					</DialogHeader>
					<form className="space-y-4" onSubmit={handleCreateCategory}>
						<div>
							<Label htmlFor="category-create-name">{t('groups.form.name')}</Label>
							<Input
								id="category-create-name"
								value={categoryForm.name}
								onChange={(event) =>
									setCategoryForm((previous) => ({ ...previous, name: event.target.value }))
								}
								required
							/>
						</div>
						<div>
							<Label htmlFor="category-create-description">{t('groups.form.description')}</Label>
							<Textarea
								id="category-create-description"
								value={categoryForm.description}
								onChange={(event) =>
									setCategoryForm((previous) => ({
										...previous,
										description: event.target.value,
									}))
								}
								rows={3}
							/>
						</div>
						<div>
							<Label htmlFor="category-create-order">{t('admin.discord.shared.sortOrder')}</Label>
							<Input
								id="category-create-order"
								type="number"
								value={categoryForm.sortOrder}
								onChange={(event) =>
									setCategoryForm((previous) => ({
										...previous,
										sortOrder: event.target.value,
									}))
								}
							/>
						</div>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setCreateCategoryOpen(false)}>
								{t('common.cancel')}
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={createCategory.isPending}
								loadingText={t('admin.discord.shared.creating')}
							>
								{t('admin.discord.shared.create')}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={editCategoryOpen} onOpenChange={setEditCategoryOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.discord.categories.editTitle')}</DialogTitle>
						<DialogDescription>{t('admin.discord.categories.editDescription')}</DialogDescription>
					</DialogHeader>
					<form className="space-y-4" onSubmit={handleUpdateCategory}>
						<div>
							<Label htmlFor="category-edit-name">{t('groups.form.name')}</Label>
							<Input
								id="category-edit-name"
								value={categoryForm.name}
								onChange={(event) =>
									setCategoryForm((previous) => ({ ...previous, name: event.target.value }))
								}
								required
							/>
						</div>
						<div>
							<Label htmlFor="category-edit-description">{t('groups.form.description')}</Label>
							<Textarea
								id="category-edit-description"
								value={categoryForm.description}
								onChange={(event) =>
									setCategoryForm((previous) => ({
										...previous,
										description: event.target.value,
									}))
								}
								rows={3}
							/>
						</div>
						<div>
							<Label htmlFor="category-edit-order">{t('admin.discord.shared.sortOrder')}</Label>
							<Input
								id="category-edit-order"
								type="number"
								value={categoryForm.sortOrder}
								onChange={(event) =>
									setCategoryForm((previous) => ({
										...previous,
										sortOrder: event.target.value,
									}))
								}
							/>
						</div>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setEditCategoryOpen(false)}>
								{t('common.cancel')}
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={updateCategory.isPending}
								loadingText={t('admin.fields.saving')}
							>
								{t('groups.edit.save')}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={deleteCategoryOpen} onOpenChange={setDeleteCategoryOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.permissionCategories.delete')}</DialogTitle>
						<DialogDescription>
							<Trans
								i18nKey="admin.discord.categories.deleteWarning"
								values={{ name: selectedCategory?.name }}
								components={{ name: <span className="font-semibold" /> }}
							/>
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteCategoryOpen(false)}>
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteCategory}
							loading={deleteCategory.isPending}
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
