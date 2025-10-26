import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { CategoryForm } from '@/components/category-form'
import { CategoryList } from '@/components/category-list'
import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
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
	useCategories,
	useCreateCategory,
	useDeleteCategory,
	useUpdateCategory,
} from '@/hooks/useCategories'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { Category, CreateCategoryRequest } from '@/lib/api'

export default function CategoriesPage() {
	usePageTitle('Admin - Categories')
	const { data: categories, isLoading } = useCategories()
	const createCategory = useCreateCategory()
	const updateCategory = useUpdateCategory()
	const deleteCategory = useDeleteCategory()

	// Dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false)
	const [editDialogOpen, setEditDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)

	// Error/success messages
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Handlers
	const handleCreate = async (data: CreateCategoryRequest) => {
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

	const handleEdit = (category: Category) => {
		setSelectedCategory(category)
		setEditDialogOpen(true)
	}

	const handleUpdate = async (data: CreateCategoryRequest) => {
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

	const handleDeleteClick = (category: Category) => {
		setSelectedCategory(category)
		setDeleteDialogOpen(true)
	}

	const handleDeleteConfirm = async () => {
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

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Category Management</h1>
					<p className="text-muted-foreground mt-1">Organize groups into categories</p>
				</div>
				<Button onClick={() => setCreateDialogOpen(true)}>
					<Plus className="mr-2 h-4 w-4" />
					Create Category
				</Button>
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
					<CardTitle>Categories</CardTitle>
					<CardDescription>Manage category settings and permissions</CardDescription>
				</CardHeader>
				<CardContent>
					<CategoryList
						categories={categories || []}
						onEdit={handleEdit}
						onDelete={handleDeleteClick}
						isLoading={isLoading}
					/>
				</CardContent>
			</Card>

			{/* Create Dialog */}
			<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create Category</DialogTitle>
						<DialogDescription>Add a new category to organize groups</DialogDescription>
					</DialogHeader>
					<CategoryForm
						onSubmit={handleCreate}
						onCancel={() => setCreateDialogOpen(false)}
						isSubmitting={createCategory.isPending}
					/>
				</DialogContent>
			</Dialog>

			{/* Edit Dialog */}
			<Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Category</DialogTitle>
						<DialogDescription>Update category settings</DialogDescription>
					</DialogHeader>
					<CategoryForm
						category={selectedCategory || undefined}
						onSubmit={handleUpdate}
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
							Are you sure you want to delete "{selectedCategory?.name}"? This action cannot be
							undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedCategory(null)
							}}
							disabled={deleteCategory.isPending}
						>
							Cancel
						</CancelButton>
						<DestructiveButton
							onClick={handleDeleteConfirm}
							loading={deleteCategory.isPending}
							loadingText="Deleting..."
							showIcon={false}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
