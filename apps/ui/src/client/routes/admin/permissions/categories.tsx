import { FileKey, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { PermissionCategoryForm } from '@/components/permission-category-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DestructiveButton } from '@/components/ui/destructive-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import {
	useCreatePermissionCategory,
	useDeletePermissionCategory,
	usePermissionCategories,
	useUpdatePermissionCategory,
} from '@/hooks/usePermissionCategories'

import type {
	CreatePermissionCategoryRequest,
	PermissionCategory,
	UpdatePermissionCategoryRequest,
} from '@/lib/api'

export default function PermissionCategoriesPage() {
	const { data: categories, isLoading } = usePermissionCategories()
	const createCategory = useCreatePermissionCategory()
	const updateCategory = useUpdatePermissionCategory()
	const deleteCategory = useDeletePermissionCategory()

	// Dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false)
	const [editDialogOpen, setEditDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedCategory, setSelectedCategory] = useState<PermissionCategory | null>(null)

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Handlers
	const handleCreate = async (data: CreatePermissionCategoryRequest) => {
		try {
			await createCategory.mutateAsync(data)
			setCreateDialogOpen(false)
			setMessage({ type: 'success', text: 'Category created successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to create category',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleEdit = async (data: UpdatePermissionCategoryRequest) => {
		if (!selectedCategory) return

		try {
			await updateCategory.mutateAsync({ id: selectedCategory.id, data })
			setEditDialogOpen(false)
			setSelectedCategory(null)
			setMessage({ type: 'success', text: 'Category updated successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update category',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDelete = async () => {
		if (!selectedCategory) return

		try {
			await deleteCategory.mutateAsync(selectedCategory.id)
			setDeleteDialogOpen(false)
			setSelectedCategory(null)
			setMessage({ type: 'success', text: 'Category deleted successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete category',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const openEditDialog = (category: PermissionCategory) => {
		setSelectedCategory(category)
		setEditDialogOpen(true)
	}

	const openDeleteDialog = (category: PermissionCategory) => {
		setSelectedCategory(category)
		setDeleteDialogOpen(true)
	}

	return (
		<div className="space-y-6">
			{/* Page Header with Navigation */}
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Permissions</h1>
						<p className="text-muted-foreground mt-1">Manage permission categories and global permissions</p>
					</div>
					<Button onClick={() => setCreateDialogOpen(true)}>
						<Plus className="mr-2 h-4 w-4" />
						New Category
					</Button>
				</div>

				{/* Sub Navigation */}
				<div className="flex gap-2">
					<Button variant="default" asChild>
						<Link to="/admin/permissions/categories">
							<FolderOpen className="mr-2 h-4 w-4" />
							Categories
						</Link>
					</Button>
					<Button variant="outline" asChild>
						<Link to="/admin/permissions/global">
							<FileKey className="mr-2 h-4 w-4" />
							Global Permissions
						</Link>
					</Button>
				</div>
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

			{/* Categories List */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>
						Categories{' '}
						{categories && (
							<span className="text-muted-foreground font-normal">({categories.length})</span>
						)}
					</CardTitle>
					<CardDescription>Create and manage permission categories</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading && (
						<div className="space-y-3">
							{[1, 2, 3].map((i) => (
								<Card key={i} className="p-4 animate-pulse">
									<div className="h-5 bg-muted rounded w-1/3 mb-2" />
									<div className="h-4 bg-muted rounded w-2/3" />
								</Card>
							))}
						</div>
					)}

					{!isLoading && categories && categories.length === 0 && (
						<Card className="p-8 text-center">
							<FolderOpen className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
							<h3 className="text-lg font-medium mb-2">No categories yet</h3>
							<p className="text-muted-foreground mb-4">
								Create your first category to organize permissions
							</p>
							<Button onClick={() => setCreateDialogOpen(true)}>
								<Plus className="w-4 h-4 mr-2" />
								Create Category
							</Button>
						</Card>
					)}

					{!isLoading && categories && categories.length > 0 && (
						<div className="space-y-3">
							{categories.map((category) => (
								<Card key={category.id} className="p-4 hover:bg-accent/50 transition-colors">
									<div className="flex items-start justify-between">
										<div className="flex-1">
											<h3 className="font-medium text-lg mb-1">{category.name}</h3>
											{category.description && (
												<p className="text-sm text-muted-foreground">{category.description}</p>
											)}
										</div>
										<div className="flex items-center gap-2 ml-4">
											<Button variant="ghost" size="sm" onClick={() => openEditDialog(category)}>
												Edit
											</Button>
											<DestructiveButton
												size="sm"
												onClick={() => openDeleteDialog(category)}
											>
												<Trash2 className="h-4 w-4" />
											</DestructiveButton>
										</div>
									</div>
								</Card>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Create Category Dialog */}
			<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create Permission Category</DialogTitle>
						<DialogDescription>
							Create a new category to organize your permissions
						</DialogDescription>
					</DialogHeader>
					<PermissionCategoryForm
						onSubmit={(data) => handleCreate(data as CreatePermissionCategoryRequest)}
						onCancel={() => setCreateDialogOpen(false)}
						isSubmitting={createCategory.isPending}
					/>
				</DialogContent>
			</Dialog>

			{/* Edit Category Dialog */}
			<Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Permission Category</DialogTitle>
						<DialogDescription>Update the category details</DialogDescription>
					</DialogHeader>
					<PermissionCategoryForm
						category={selectedCategory || undefined}
						onSubmit={handleEdit}
						onCancel={() => {
							setEditDialogOpen(false)
							setSelectedCategory(null)
						}}
						isSubmitting={updateCategory.isPending}
					/>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Category</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "{selectedCategory?.name}"? Permissions in this category
							will not be deleted, but they will no longer be organized.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedCategory(null)
							}}
							disabled={deleteCategory.isPending}
						>
							Cancel
						</Button>
						<DestructiveButton onClick={handleDelete} loading={deleteCategory.isPending}>
							Delete Category
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
