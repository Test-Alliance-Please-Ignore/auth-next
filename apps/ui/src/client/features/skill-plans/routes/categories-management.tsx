import { Edit2, Plus, Settings, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Container } from '../../../components/ui/container'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '../../../components/ui/dialog'
import { LoadingPage } from '../../../components/ui/loading'
import { PageHeader } from '../../../components/ui/page-header'
import { Section } from '../../../components/ui/section'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '../../../components/ui/table'
import { useAuth } from '../../../hooks/useAuth'
import { usePageTitle } from '../../../hooks/usePageTitle'
import { CategoryForm } from '../components/category-form'
import {
	useCreateCategory,
	useDeleteCategory,
	useSkillPlanCategories,
	useUpdateCategory,
} from '../hooks'

import type { SkillPlanCategory } from '../types'

export default function CategoriesManagement() {
	usePageTitle('Manage Skill Plan Categories')

	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { data: categories, isLoading: categoriesLoading } = useSkillPlanCategories()
	const createCategory = useCreateCategory()
	const updateCategory = useUpdateCategory()
	const deleteCategory = useDeleteCategory()

	const [showCreateDialog, setShowCreateDialog] = useState(false)
	const [editingCategory, setEditingCategory] = useState<SkillPlanCategory | null>(null)

	// Check if user has permission to manage categories
	// For now, we'll allow admins only - you can add more permission checks here
	const canManageCategories = user?.is_admin

	// Redirect if not authenticated
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/skill-plans" replace />
	}

	// Redirect if no permission
	if (!authLoading && !canManageCategories) {
		return <Navigate to="/skill-plans" replace />
	}

	const handleCreateCategory = async (data: {
		name: string
		description: string
		displayOrder?: number
	}) => {
		try {
			await createCategory.mutateAsync(data)
			setShowCreateDialog(false)
		} catch (error) {
			console.error('Failed to create category:', error)
		}
	}

	const handleUpdateCategory = async (data: {
		name: string
		description: string
		displayOrder?: number
	}) => {
		if (!editingCategory) return

		try {
			await updateCategory.mutateAsync({
				categoryId: editingCategory.id,
				data,
			})
			setEditingCategory(null)
		} catch (error) {
			console.error('Failed to update category:', error)
		}
	}

	const handleDeleteCategory = async (categoryId: string) => {
		if (confirm('Are you sure you want to delete this category? This cannot be undone.')) {
			try {
				await deleteCategory.mutateAsync(categoryId)
			} catch (error) {
				console.error('Failed to delete category:', error)
			}
		}
	}

	if (categoriesLoading || authLoading) {
		return <LoadingPage />
	}

	const sortedCategories = categories
		? [...categories].sort((a, b) => a.displayOrder - b.displayOrder)
		: []

	return (
		<Container>
			<PageHeader
				title="Manage Categories"
				description="Create and manage categories for organizing skill plans"
			/>

			<Section>
				{/* Actions bar */}
				<div className="flex justify-between items-center mb-6">
					<h2 className="text-xl font-semibold">Categories ({sortedCategories.length})</h2>
					<Button onClick={() => setShowCreateDialog(true)}>
						<Plus className="h-4 w-4 mr-2" />
						New Category
					</Button>
				</div>

				{/* Categories table */}
				<Card>
					<CardHeader>
						<CardTitle>Skill Plan Categories</CardTitle>
					</CardHeader>
					<CardContent>
						{sortedCategories.length > 0 ? (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-[50px]">Order</TableHead>
										<TableHead>Name</TableHead>
										<TableHead>Description</TableHead>
										<TableHead className="w-[100px]">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{sortedCategories.map((category) => (
										<TableRow key={category.id}>
											<TableCell>
												<Badge variant="outline">{category.displayOrder}</Badge>
											</TableCell>
											<TableCell className="font-medium">{category.name}</TableCell>
											<TableCell className="text-muted-foreground">
												{category.description}
											</TableCell>
											<TableCell>
												<div className="flex gap-2">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => setEditingCategory(category)}
													>
														<Edit2 className="h-4 w-4" />
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleDeleteCategory(category.id)}
														className="text-destructive hover:text-destructive"
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						) : (
							<div className="text-center py-8 text-muted-foreground">
								<Settings className="h-12 w-12 mx-auto mb-4 opacity-20" />
								<p>No categories have been created yet.</p>
								<Button className="mt-4" onClick={() => setShowCreateDialog(true)}>
									<Plus className="h-4 w-4 mr-2" />
									Create First Category
								</Button>
							</div>
						)}
					</CardContent>
				</Card>
			</Section>

			{/* Create category dialog */}
			<Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create New Category</DialogTitle>
						<DialogDescription>Create a new category to organize skill plans.</DialogDescription>
					</DialogHeader>
					<CategoryForm
						onSubmit={handleCreateCategory}
						onCancel={() => setShowCreateDialog(false)}
						isSubmitting={createCategory.isPending}
						mode="create"
					/>
				</DialogContent>
			</Dialog>

			{/* Edit category dialog */}
			<Dialog open={!!editingCategory} onOpenChange={(open) => !open && setEditingCategory(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Category</DialogTitle>
						<DialogDescription>Update the category details.</DialogDescription>
					</DialogHeader>
					{editingCategory && (
						<CategoryForm
							initialData={editingCategory}
							onSubmit={handleUpdateCategory}
							onCancel={() => setEditingCategory(null)}
							isSubmitting={updateCategory.isPending}
							mode="edit"
						/>
					)}
				</DialogContent>
			</Dialog>
		</Container>
	)
}
