import { ArrowLeft, Edit2, Plus, Settings, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router'

import { useAppTranslation } from '@/i18n'

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
import { useUserPermissions } from '../../../hooks/useUserPermissions'
import { CategoryForm } from '../components/category-form'
import {
	useCreateCategory,
	useDeleteCategory,
	useSkillPlanCategories,
	useUpdateCategory,
} from '../hooks'

import type { SkillPlanCategory } from '../types'

export default function CategoriesManagement() {
	const { t } = useAppTranslation()

	usePageTitle(t('skillPlans.manageSkillPlanCategories'))

	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasPermission } = useUserPermissions()
	const { data: categories, isLoading: categoriesLoading } = useSkillPlanCategories()
	const createCategory = useCreateCategory()
	const updateCategory = useUpdateCategory()
	const deleteCategory = useDeleteCategory()

	const [showCreateDialog, setShowCreateDialog] = useState(false)
	const [editingCategory, setEditingCategory] = useState<SkillPlanCategory | null>(null)

	const canCreateCategories = user?.is_admin || hasPermission('urn:skill-plans:categories:create')
	const canManageCategories = user?.is_admin || hasPermission('urn:skill-plans:categories:manage')
	const canAccessPage = canCreateCategories || canManageCategories

	// Redirect if not authenticated
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/skill-plans" replace />
	}

	// Redirect if no permission
	if (!authLoading && !canAccessPage) {
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
		if (confirm(t('skillPlans.areYouSureYouWantToDeleteThisCategoryThis'))) {
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
				title={t('skillPlans.manageCategories')}
				description={t('skillPlans.createAndManageCategoriesForOrganizingSkillPlans')}
				action={
					<Button variant="ghost" size="sm" asChild>
						<Link to="/skill-plans">
							<ArrowLeft className="h-4 w-4" />
							{t('skillPlans.backToPlans')}
						</Link>
					</Button>
				}
			/>

			<Section>
				{/* Actions bar */}
				<div className="flex justify-between items-center mb-6">
					<h2 className="text-xl font-semibold">
						{t('skillPlans.categories2')}
						{sortedCategories.length})
					</h2>
					{canCreateCategories ? (
						<Button onClick={() => setShowCreateDialog(true)}>
							<Plus className="h-4 w-4" />
							{t('skillPlans.newCategory')}
						</Button>
					) : null}
				</div>

				{/* Categories table */}
				<Card>
					<CardHeader>
						<CardTitle>{t('skillPlans.skillPlanCategories')}</CardTitle>
					</CardHeader>
					<CardContent>
						{sortedCategories.length > 0 ? (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-[50px]">{t('skillPlans.order')}</TableHead>
										<TableHead>{t('skillPlans.name')}</TableHead>
										<TableHead>{t('skillPlans.description')}</TableHead>
										<TableHead className="w-[100px]">{t('skillPlans.actions')}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{sortedCategories.map((category) => (
										<TableRow key={category.id}>
											<TableCell>
												<Badge variant="ghost">{category.displayOrder}</Badge>
											</TableCell>
											<TableCell className="font-medium">{category.name}</TableCell>
											<TableCell className="text-muted-foreground">
												{category.description}
											</TableCell>
											<TableCell>
												{canManageCategories ? (
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
												) : (
													<span className="text-xs text-muted-foreground">
														{t('skillPlans.viewOnly')}
													</span>
												)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						) : (
							<div className="text-center py-8 text-muted-foreground">
								<Settings className="h-12 w-12 mx-auto mb-4 opacity-20" />
								<p>{t('skillPlans.noCategoriesHaveBeenCreatedYet')}</p>
								{canCreateCategories ? (
									<Button className="mt-4" onClick={() => setShowCreateDialog(true)}>
										<Plus className="h-4 w-4" />
										{t('skillPlans.createFirstCategory')}
									</Button>
								) : null}
							</div>
						)}
					</CardContent>
				</Card>
			</Section>

			{/* Create category dialog */}
			<Dialog open={canCreateCategories && showCreateDialog} onOpenChange={setShowCreateDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('skillPlans.createNewCategory')}</DialogTitle>
						<DialogDescription>
							{t('skillPlans.createANewCategoryToOrganizeSkillPlans')}
						</DialogDescription>
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
			<Dialog
				open={canManageCategories && !!editingCategory}
				onOpenChange={(open) => !open && setEditingCategory(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('skillPlans.editCategory')}</DialogTitle>
						<DialogDescription>{t('skillPlans.updateTheCategoryDetails')}</DialogDescription>
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
