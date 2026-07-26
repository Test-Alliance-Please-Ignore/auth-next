import { ArrowLeft, Edit, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
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

import type {
	CreateDiscordCommandCategoryRequest,
	DiscordCommandCategory,
	UpdateDiscordCommandCategoryRequest,
} from '@/lib/api'
import type { FormEvent } from 'react'

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
	usePageTitle('Admin - Discord Command Categories')
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
			await createCategory.mutateAsync(toCategoryPayload(categoryForm) as CreateDiscordCommandCategoryRequest)
			setCreateCategoryOpen(false)
			resetCategoryDialogState()
			showSuccess('Discord command category created')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to create command category')
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
			showSuccess('Discord command category updated')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update command category')
		}
	}

	const handleDeleteCategory = async () => {
		if (!selectedCategory) return
		try {
			await deleteCategory.mutateAsync(selectedCategory.id)
			setDeleteCategoryOpen(false)
			resetCategoryDialogState()
			showSuccess('Discord command category deleted')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to delete command category')
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-3">
				<div>
					<div className="text-sm text-muted-foreground">Discord / Commands / Categories</div>
					<h1 className="text-3xl font-bold gradient-text">Discord Command Categories</h1>
					<p className="text-muted-foreground mt-1">Manage command category labels and ordering</p>
				</div>
				<div className="flex items-center gap-2">
					<Button asChild variant="ghost">
						<Link to="/admin/discord-commands">
							<ArrowLeft className="h-4 w-4" />
							Back To Commands
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
						New Category
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
					<CardTitle>Categories</CardTitle>
					<CardDescription>Used when creating or editing slash commands</CardDescription>
				</CardHeader>
				<CardContent>
					{categoriesLoading ? (
						<p className="text-muted-foreground">Loading categories...</p>
					) : categories.length === 0 ? (
						<p className="text-muted-foreground">No categories configured yet.</p>
					) : (
						<div className="space-y-2">
							{categories
								.slice()
								.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
								.map((category) => (
									<div key={category.id} className="flex items-start justify-between rounded-md border p-3">
										<div className="space-y-1">
											<div className="flex items-center gap-2">
												<span className="font-medium">{category.name}</span>
												<Badge variant="secondary">Order {category.sortOrder}</Badge>
											</div>
											{category.description && (
												<p className="text-sm text-muted-foreground">{category.description}</p>
											)}
										</div>
										<div className="flex items-center gap-2">
											<Button variant="ghost" size="sm" onClick={() => openCategoryEditDialog(category)}>
												<Edit className="h-4 w-4" />
											</Button>
											<Button
												variant="destructive"
												size="sm"
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
						<DialogTitle>Create Command Category</DialogTitle>
						<DialogDescription>Add a category for grouping slash commands</DialogDescription>
					</DialogHeader>
					<form className="space-y-4" onSubmit={handleCreateCategory}>
						<div>
							<Label htmlFor="category-create-name">Name</Label>
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
							<Label htmlFor="category-create-description">Description</Label>
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
							<Label htmlFor="category-create-order">Sort Order</Label>
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
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={createCategory.isPending}
								loadingText="Creating..."
							>
								Create
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={editCategoryOpen} onOpenChange={setEditCategoryOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Command Category</DialogTitle>
						<DialogDescription>Update category metadata</DialogDescription>
					</DialogHeader>
					<form className="space-y-4" onSubmit={handleUpdateCategory}>
						<div>
							<Label htmlFor="category-edit-name">Name</Label>
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
							<Label htmlFor="category-edit-description">Description</Label>
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
							<Label htmlFor="category-edit-order">Sort Order</Label>
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
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={updateCategory.isPending}
								loadingText="Saving..."
							>
								Save Changes
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={deleteCategoryOpen} onOpenChange={setDeleteCategoryOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Category</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete{' '}
							<span className="font-semibold">{selectedCategory?.name}</span>?
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteCategoryOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteCategory}
							loading={deleteCategory.isPending}
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
