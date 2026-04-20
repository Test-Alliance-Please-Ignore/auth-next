import { Edit2, FileKey, FolderOpen, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { PermissionFormDialog } from '@/components/permission-form-dialog'
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'
import { usePermissionCategories } from '@/hooks/usePermissionCategories'
import {
	useCreatePermission,
	useDeletePermission,
	useGlobalPermissions,
	useUpdatePermission,
} from '@/hooks/usePermissions'

import type {
	CreatePermissionRequest,
	PermissionWithDetails,
	UpdatePermissionRequest,
} from '@/lib/api'

export default function GlobalPermissionsPage() {
	usePageTitle('Admin - Global Permissions')
	const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined)
	const [searchQuery, setSearchQuery] = useState('')

	const { data: permissions, isLoading } = useGlobalPermissions(selectedCategoryId)
	const { data: categories } = usePermissionCategories()
	const createPermission = useCreatePermission()
	const updatePermission = useUpdatePermission()
	const deletePermission = useDeletePermission()

	// Dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false)
	const [editDialogOpen, setEditDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedPermission, setSelectedPermission] = useState<PermissionWithDetails | null>(null)

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Handlers
	const handleCreate = async (data: CreatePermissionRequest) => {
		try {
			await createPermission.mutateAsync(data)
			setCreateDialogOpen(false)
			setMessage({ type: 'success', text: 'Permission created successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to create permission',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleEdit = async (data: UpdatePermissionRequest) => {
		if (!selectedPermission) return

		try {
			await updatePermission.mutateAsync({ id: selectedPermission.id, data })
			setEditDialogOpen(false)
			setSelectedPermission(null)
			setMessage({ type: 'success', text: 'Permission updated successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update permission',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDelete = async () => {
		if (!selectedPermission) return

		try {
			await deletePermission.mutateAsync(selectedPermission.id)
			setDeleteDialogOpen(false)
			setSelectedPermission(null)
			setMessage({ type: 'success', text: 'Permission deleted successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete permission',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const openEditDialog = (permission: PermissionWithDetails) => {
		setSelectedPermission(permission)
		setEditDialogOpen(true)
	}

	const openDeleteDialog = (permission: PermissionWithDetails) => {
		setSelectedPermission(permission)
		setDeleteDialogOpen(true)
	}

	// Filter permissions by search query
	const filteredPermissions =
		permissions?.filter((p) => {
			const query = searchQuery.toLowerCase()
			return (
				p.name.toLowerCase().includes(query) ||
				p.urn.toLowerCase().includes(query) ||
				p.description?.toLowerCase().includes(query)
			)
		}) || []

	return (
		<div className="space-y-6">
			{/* Page Header with Navigation */}
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Permissions</h1>
						<p className="text-muted-foreground mt-1">
							Manage permission categories and global permissions
						</p>
					</div>
					<Button onClick={() => setCreateDialogOpen(true)}>
						<Plus className="h-4 w-4" />
						New Permission
					</Button>
				</div>

				{/* Sub Navigation */}
				<div className="flex gap-2">
					<Button variant="ghost" asChild>
						<Link to="/admin/permissions/categories">
							<FolderOpen className="h-4 w-4" />
							Categories
						</Link>
					</Button>
					<Button variant="primary" asChild>
						<Link to="/admin/permissions/global">
							<FileKey className="h-4 w-4" />
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

			{/* Filters */}
			<Card>
				<CardContent className="pt-6">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{/* Search */}
						<div className="space-y-2">
							<Label htmlFor="search">Search</Label>
							<div className="relative">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									id="search"
									placeholder="Search by name, URN, or description..."
									value={searchQuery}
									onChange={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
									className="pl-9"
								/>
							</div>
						</div>

						{/* Category Filter */}
						<div className="space-y-2">
							<Label htmlFor="category-filter">Filter by Category</Label>
							<Select
								value={selectedCategoryId || 'all'}
								onValueChange={(value) =>
									setSelectedCategoryId(value === 'all' ? undefined : value)
								}
								inputId="category-filter"
								options={[
									{ value: 'all', label: 'All categories' },
									{ value: 'uncategorized', label: 'Uncategorized' },
									...(categories?.map((category) => ({ value: category.id,
										label: category.name,
									})) ?? []),
								]}
								placeholder="All categories"
							/>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Permissions List */}
			<Card>
				<CardHeader>
					<CardTitle>
						Permissions{' '}
						{filteredPermissions && (
							<span className="text-muted-foreground font-normal">
								({filteredPermissions.length}
								{searchQuery || selectedCategoryId ? ' filtered' : ''})
							</span>
						)}
					</CardTitle>
					<CardDescription>
						Manage global permissions that can be attached to groups
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="space-y-3">
							{[1, 2, 3].map((i) => (
								<div key={i} className="h-12 animate-pulse rounded-md bg-muted/30" />
							))}
						</div>
					) : filteredPermissions.length === 0 ? (
						<div className="rounded-lg border border-dashed p-8 text-center">
							{searchQuery || selectedCategoryId ? (
								<>
									<Search className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
									<h3 className="text-lg font-medium mb-2">No permissions found</h3>
									<p className="text-muted-foreground mb-4">Try adjusting your search or filter criteria</p>
									<Button variant="ghost" onClick={() => { setSearchQuery(''); setSelectedCategoryId(undefined) }}>
										Clear filters
									</Button>
								</>
							) : (
								<>
									<FileKey className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
									<h3 className="text-lg font-medium mb-2">No permissions yet</h3>
									<p className="text-muted-foreground mb-4">Create your first global permission to get started</p>
									<Button onClick={() => setCreateDialogOpen(true)}>
										<Plus className="w-4 h-4 mr-2" />
										Create Permission
									</Button>
								</>
							)}
						</div>
					) : (
						<div className="rounded-md border bg-card">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>URN</TableHead>
										<TableHead>Category</TableHead>
										<TableHead>Description</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredPermissions.map((permission) => (
										<TableRow key={permission.id}>
											<TableCell className="font-medium">{permission.name}</TableCell>
											<TableCell className="font-mono text-xs text-muted-foreground">{permission.urn}</TableCell>
											<TableCell>
												{permission.category ? (
													<Badge variant="secondary" className="text-xs">{permission.category.name}</Badge>
												) : (
													<span className="text-xs text-muted-foreground">—</span>
												)}
											</TableCell>
											<TableCell className="text-sm text-muted-foreground max-w-sm">
												<div className="truncate">{permission.description || '—'}</div>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-2">
													<Button variant="ghost" size="icon" onClick={() => openEditDialog(permission)} title="Edit permission">
														<Edit2 className="h-4 w-4" />
													</Button>
													<Button variant="ghost" size="icon" onClick={() => openDeleteDialog(permission)} title="Delete permission">
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

			{/* Create Permission Dialog */}
			<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create Global Permission</DialogTitle>
						<DialogDescription>
							Create a new reusable permission that can be attached to groups
						</DialogDescription>
					</DialogHeader>
					<PermissionFormDialog
						categories={categories || []}
						onSubmit={(data) => handleCreate(data as CreatePermissionRequest)}
						onCancel={() => setCreateDialogOpen(false)}
						isSubmitting={createPermission.isPending}
					/>
				</DialogContent>
			</Dialog>

			{/* Edit Permission Dialog */}
			<Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Permission</DialogTitle>
						<DialogDescription>Update the permission details</DialogDescription>
					</DialogHeader>
					<PermissionFormDialog
						permission={selectedPermission || undefined}
						categories={categories || []}
						onSubmit={handleEdit}
						onCancel={() => {
							setEditDialogOpen(false)
							setSelectedPermission(null)
						}}
						isSubmitting={updatePermission.isPending}
					/>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Permission</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "{selectedPermission?.name}"? This will remove it from
							all groups that use this permission.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedPermission(null)
							}}
							disabled={deletePermission.isPending}
						>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleDelete} loading={deletePermission.isPending}>
							Delete Permission
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
