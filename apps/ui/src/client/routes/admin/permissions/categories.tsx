import { Edit2, FileKey, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { PermissionCategoryForm } from '@/components/permission-category-form'
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'
import {
	useCreatePermissionCategory,
	useDeletePermissionCategory,
	usePermissionCategories,
	useUpdatePermissionCategory,
} from '@/hooks/usePermissionCategories'
import { formatNumber, useAppTranslation } from '@/i18n'

import type { AppTranslationKey } from '@/i18n'
import type {
	CreatePermissionCategoryRequest,
	PermissionCategory,
	UpdatePermissionCategoryRequest,
} from '@/lib/api'

export default function PermissionCategoriesPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('admin.permissionCategories.pageTitle'))
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
	const [message, setMessage] = useState<{
		type: 'success' | 'error'
		key: AppTranslationKey
		detail?: string
	} | null>(null)

	// Handlers
	const handleCreate = async (data: CreatePermissionCategoryRequest) => {
		try {
			await createCategory.mutateAsync(data)
			setCreateDialogOpen(false)
			setMessage({ type: 'success', key: 'admin.permissionCategories.createSuccess' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.permissionCategories.createError',
				detail: error instanceof Error ? error.message : undefined,
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
			setMessage({ type: 'success', key: 'admin.permissionCategories.updateSuccess' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.permissionCategories.updateError',
				detail: error instanceof Error ? error.message : undefined,
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
			setMessage({ type: 'success', key: 'admin.permissionCategories.deleteSuccess' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.permissionCategories.deleteError',
				detail: error instanceof Error ? error.message : undefined,
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
						<h1 className="text-3xl font-bold gradient-text">{t('admin.nav.permissions')}</h1>
						<p className="text-muted-foreground mt-1">{t('admin.permissions.description')}</p>
					</div>
					<Button onClick={() => setCreateDialogOpen(true)}>
						<Plus className="h-4 w-4" />
						{t('admin.permissionCategories.new')}
					</Button>
				</div>

				{/* Sub Navigation */}
				<div className="flex gap-2">
					<Button variant="primary" asChild>
						<Link to="/admin/permissions/categories">
							<FolderOpen className="h-4 w-4" />
							{t('admin.nav.categories')}
						</Link>
					</Button>
					<Button variant="ghost" asChild>
						<Link to="/admin/permissions/global">
							<FileKey className="h-4 w-4" />
							{t('admin.permissions.global')}
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
							{message.detail ?? t(message.key)}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Categories List */}
			<Card>
				<CardHeader>
					<CardTitle>
						{t('admin.nav.categories')}{' '}
						{categories && (
							<span className="text-muted-foreground font-normal">
								({formatNumber(categories.length)})
							</span>
						)}
					</CardTitle>
					<CardDescription>{t('admin.permissionCategories.listDescription')}</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="space-y-3">
							{[1, 2, 3].map((i) => (
								<div key={i} className="h-12 animate-pulse rounded-md bg-muted/30" />
							))}
						</div>
					) : !categories || categories.length === 0 ? (
						<div className="rounded-lg border border-dashed p-8 text-center">
							<FolderOpen className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
							<h3 className="text-lg font-medium mb-2">{t('admin.permissionCategories.empty')}</h3>
							<p className="text-muted-foreground mb-4">
								{t('admin.permissionCategories.emptyDescription')}
							</p>
							<Button onClick={() => setCreateDialogOpen(true)}>
								<Plus className="w-4 h-4 mr-2" />
								{t('admin.permissionCategories.create')}
							</Button>
						</div>
					) : (
						<div className="rounded-md border bg-card">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t('admin.fields.name')}</TableHead>
										<TableHead>{t('admin.fields.description')}</TableHead>
										<TableHead className="text-right">{t('admin.fields.actions')}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{categories.map((category) => (
										<TableRow key={category.id}>
											<TableCell className="font-medium">{category.name}</TableCell>
											<TableCell className="text-sm text-muted-foreground max-w-sm">
												<div className="truncate">{category.description || '—'}</div>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-2">
													<Button
														variant="ghost"
														size="icon"
														onClick={() => openEditDialog(category)}
														title={t('admin.permissionCategories.editAction')}
													>
														<Edit2 className="h-4 w-4" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														onClick={() => openDeleteDialog(category)}
														title={t('admin.permissionCategories.deleteAction')}
													>
														<Trash2 className="h-4 w-4 text-destructive" />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Create Category Dialog */}
			<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.permissionCategories.createTitle')}</DialogTitle>
						<DialogDescription>
							{t('admin.permissionCategories.createDescription')}
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
						<DialogTitle>{t('admin.permissionCategories.editTitle')}</DialogTitle>
						<DialogDescription>{t('admin.permissionCategories.editDescription')}</DialogDescription>
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
						<DialogTitle>{t('admin.permissionCategories.delete')}</DialogTitle>
						<DialogDescription>
							{t('admin.permissionCategories.deleteWarning', { name: selectedCategory?.name })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedCategory(null)
							}}
							disabled={deleteCategory.isPending}
						>
							{t('common.cancel')}
						</Button>
						<Button variant="destructive" onClick={handleDelete} loading={deleteCategory.isPending}>
							{t('admin.permissionCategories.delete')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
