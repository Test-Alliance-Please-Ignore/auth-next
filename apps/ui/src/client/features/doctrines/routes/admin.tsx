/**
 * Doctrines Admin Page
 *
 * Manage categories, staging systems, and all fittings
 */

import { ArrowLeft, Edit, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { esiApi } from '@/lib/esi-api'
import toast from '@/lib/toast'

import {
	useCreateDoctrineCategory,
	useCreateStagingSystem,
	useDeleteDoctrineCategory,
	useDeleteFitting,
	useDeleteStagingSystem,
	useDoctrineCategories,
	useFittingsWithDoctrines,
	useStagingSystems,
	useUpdateDoctrineCategory,
	useUpdateStagingSystem,
} from '../hooks'

import type { DoctrineCategory, StagingSystem } from '../types'

// ============================================
// Category Form Dialog
// ============================================

function CategoryDialog({
	open,
	onOpenChange,
	category,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	category?: DoctrineCategory
}) {
	const [name, setName] = useState(category?.name || '')
	const [sortOrder, setSortOrder] = useState(category?.sortOrder ?? 0)
	const createMutation = useCreateDoctrineCategory()
	const updateMutation = useUpdateDoctrineCategory()

	const isEdit = !!category

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		try {
			if (isEdit) {
				await updateMutation.mutateAsync({ id: category.id, data: { name, sortOrder } })
				toast.success('Category updated')
			} else {
				await createMutation.mutateAsync({ name, sortOrder })
				toast.success('Category created')
			}
			onOpenChange(false)
			setName('')
			setSortOrder(0)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save category')
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>{isEdit ? 'Edit Category' : 'New Category'}</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="cat-name">Name</Label>
							<Input
								id="cat-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g., Subcap Doctrines"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="cat-sort">Sort Order</Label>
							<Input
								id="cat-sort"
								type="number"
								value={sortOrder}
								onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
								min="0"
								className="w-32"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="cancel" type="button" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button
							variant="confirm"
							type="submit"
							loading={createMutation.isPending || updateMutation.isPending}
							loadingText="Saving..."
							disabled={!name.trim()}
						>
							{isEdit ? 'Update' : 'Create'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

// ============================================
// Staging System Form Dialog
// ============================================

function StagingSystemDialog({
	open,
	onOpenChange,
	stagingSystem,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	stagingSystem?: StagingSystem
}) {
	const [solarSystemName, setSolarSystemName] = useState(stagingSystem?.solarSystemName || '')
	const [solarSystemId, setSolarSystemId] = useState(stagingSystem?.solarSystemId || '')
	const [sortOrder, setSortOrder] = useState(stagingSystem?.sortOrder ?? 0)
	const createMutation = useCreateStagingSystem()
	const updateMutation = useUpdateStagingSystem()

	const isEdit = !!stagingSystem

	const searchSystems = async (query: string) => {
		const results = await esiApi.searchSystems(query)
		return results.map((r) => ({
			value: r.systemId,
			label: r.systemName,
			description: r.regionName,
		}))
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		try {
			if (isEdit) {
				await updateMutation.mutateAsync({
					id: stagingSystem.id,
					data: { solarSystemName, solarSystemId, sortOrder },
				})
				toast.success('Staging system updated')
			} else {
				await createMutation.mutateAsync({ solarSystemName, solarSystemId, sortOrder })
				toast.success('Staging system created')
			}
			onOpenChange(false)
			setSolarSystemName('')
			setSolarSystemId('')
			setSortOrder(0)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save staging system')
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>{isEdit ? 'Edit Staging System' : 'New Staging System'}</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-4">
						{isEdit ? (
							<div className="space-y-2">
								<Label>System</Label>
								<p className="text-sm text-foreground">{solarSystemName}</p>
							</div>
						) : (
							<div className="space-y-2">
								<Label>Solar System</Label>
								<Select
									options={[]}
									value={solarSystemId}
									onValueChange={(val, option) => {
										setSolarSystemId(val)
										setSolarSystemName(option?.label || '')
									}}
									searchable
									searchDelegate={searchSystems}
									minQueryLength={3}
									debounceMs={500}
									placeholder="Search for a system..."
									emptyText="No systems found"
									queryHintText="Type at least 3 characters to search"
								/>
							</div>
						)}
						<div className="space-y-2">
							<Label htmlFor="sys-sort">Sort Order</Label>
							<Input
								id="sys-sort"
								type="number"
								value={sortOrder}
								onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
								min="0"
								className="w-32"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="cancel" type="button" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button
							variant="confirm"
							type="submit"
							loading={createMutation.isPending || updateMutation.isPending}
							loadingText="Saving..."
							disabled={!solarSystemName.trim() || !solarSystemId.trim()}
						>
							{isEdit ? 'Update' : 'Create'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

// ============================================
// Main Admin Page
// ============================================

export default function DoctrinesAdminPage() {
	usePageTitle('Doctrines Admin')

	const { data: categories, isLoading: categoriesLoading } = useDoctrineCategories()
	const { data: stagingSystems, isLoading: stagingLoading } = useStagingSystems()
	const { data: fittingsWithDoctrines, isLoading: fittingsLoading } = useFittingsWithDoctrines()
	const deleteCategoryMutation = useDeleteDoctrineCategory()
	const deleteStagingMutation = useDeleteStagingSystem()
	const deleteFittingMutation = useDeleteFitting()

	const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
	const [editingCategory, setEditingCategory] = useState<DoctrineCategory | undefined>()
	const [stagingDialogOpen, setStagingDialogOpen] = useState(false)
	const [editingStaging, setEditingStaging] = useState<StagingSystem | undefined>()
	const [fittingSearch, setFittingSearch] = useState('')
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const handleDeleteCategory = (id: string) => {
		requestConfirmation({
			title: 'Delete Category',
			description: 'Delete this category? Doctrines using it will become uncategorized.',
			confirmLabel: 'Delete',
			intent: 'destructive',
			onConfirm: async () => {
				await deleteCategoryMutation.mutateAsync(id)
				toast.success('Category deleted')
			},
		})
	}

	const handleDeleteStagingSystem = (id: string) => {
		requestConfirmation({
			title: 'Delete Staging System',
			description: 'Delete this staging system? It will be removed from all doctrines.',
			confirmLabel: 'Delete',
			intent: 'destructive',
			onConfirm: async () => {
				await deleteStagingMutation.mutateAsync(id)
				toast.success('Staging system deleted')
			},
		})
	}

	const handleDeleteFitting = (id: string, name: string) => {
		requestConfirmation({
			title: 'Delete Fitting',
			description: `Delete fitting "${name}"? It will be removed from all doctrines.`,
			confirmLabel: 'Delete',
			intent: 'destructive',
			onConfirm: async () => {
				await deleteFittingMutation.mutateAsync(id)
				toast.success('Fitting deleted')
			},
		})
	}

	const openEditCategory = (cat: DoctrineCategory) => {
		setEditingCategory(cat)
		setCategoryDialogOpen(true)
	}

	const openNewCategory = () => {
		setEditingCategory(undefined)
		setCategoryDialogOpen(true)
	}

	const openEditStaging = (sys: StagingSystem) => {
		setEditingStaging(sys)
		setStagingDialogOpen(true)
	}

	const openNewStaging = () => {
		setEditingStaging(undefined)
		setStagingDialogOpen(true)
	}

	const filteredFittings = fittingsWithDoctrines?.filter(
		(f) =>
			fittingSearch === '' ||
			f.name.toLowerCase().includes(fittingSearch.toLowerCase()) ||
			f.shipName.toLowerCase().includes(fittingSearch.toLowerCase())
	)

	return (
		<Container>
			<Button asChild variant="ghost" size="sm" className="mb-4">
				<Link to="/doctrines">
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back to Doctrines
				</Link>
			</Button>

			<PageHeader
				title="Doctrines Admin"
				description="Manage categories, staging systems, and fittings"
			/>

			<Tabs defaultValue="fittings">
				<TabsList className="mb-6">
					<TabsTrigger value="fittings">All Fittings</TabsTrigger>
					<TabsTrigger value="categories">Categories</TabsTrigger>
					<TabsTrigger value="staging">Staging Systems</TabsTrigger>
				</TabsList>

				{/* All Fittings Tab */}
				<TabsContent value="fittings">
					<Card>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
							<CardTitle className="text-lg">All Fittings</CardTitle>
							<Input
								placeholder="Search by ship or fitting name..."
								value={fittingSearch}
								onChange={(e) => setFittingSearch(e.target.value)}
								className="max-w-xs"
							/>
						</CardHeader>
						<CardContent>
							{fittingsLoading ? (
								<LoadingSpinner />
							) : !filteredFittings || filteredFittings.length === 0 ? (
								<p className="text-sm text-muted-foreground text-center py-4">
									No fittings found.
								</p>
							) : (
								<div className="space-y-2">
									{filteredFittings.map((fitting) => (
										<div
											key={fitting.id}
											className="flex items-center justify-between rounded-md border px-3 py-2"
										>
											<div className="flex items-center gap-3 min-w-0">
												<img
													src={`https://images.evetech.net/types/${fitting.shipTypeId}/icon?size=64`}
													alt={fitting.shipName}
													className="h-8 w-8 rounded shrink-0"
													loading="lazy"
												/>
												<div className="min-w-0">
													<span className="font-medium truncate block">
														{fitting.name}
													</span>
													<span className="text-xs text-muted-foreground truncate block">
														{fitting.shipName} &middot; {fitting.category}
													</span>
												</div>
												{fitting.doctrines.length > 0 && (
													<div className="flex flex-wrap gap-1 ml-2">
														{fitting.doctrines.map((d) => (
															<Badge key={d.id} variant="secondary" className="text-xs">
																{d.name}
															</Badge>
														))}
													</div>
												)}
											</div>
											<div className="flex gap-1 shrink-0 ml-2">
												<Button
													asChild
													variant="ghost"
													size="icon"
													className="h-7 w-7"
												>
													<Link to={`/doctrines/fittings/${fitting.id}/edit`}>
														<Edit className="h-3.5 w-3.5" />
													</Link>
												</Button>
												<Button
													variant="ghost"
													size="icon"
													className="h-7 w-7 text-destructive hover:text-destructive"
													onClick={() => handleDeleteFitting(fitting.id, fitting.name)}
												>
													<Trash2 className="h-3.5 w-3.5" />
												</Button>
											</div>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* Categories Tab */}
				<TabsContent value="categories">
					<Card>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
							<CardTitle className="text-lg">Categories</CardTitle>
							<Button size="sm" onClick={openNewCategory}>
								<Plus className="h-4 w-4 mr-1" />
								Add
							</Button>
						</CardHeader>
						<CardContent>
							{categoriesLoading ? (
								<LoadingSpinner />
							) : !categories || categories.length === 0 ? (
								<p className="text-sm text-muted-foreground text-center py-4">
									No categories yet. Create one to group your doctrines.
								</p>
							) : (
								<div className="space-y-2">
									{categories.map((cat) => (
										<div
											key={cat.id}
											className="flex items-center justify-between rounded-md border px-3 py-2"
										>
											<div>
												<span className="font-medium">{cat.name}</span>
												<span className="text-xs text-muted-foreground ml-2">
													(order: {cat.sortOrder})
												</span>
											</div>
											<div className="flex gap-1">
												<Button
													variant="ghost"
													size="icon"
													className="h-7 w-7"
													onClick={() => openEditCategory(cat)}
												>
													<Edit className="h-3.5 w-3.5" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													className="h-7 w-7 text-destructive hover:text-destructive"
													onClick={() => handleDeleteCategory(cat.id)}
												>
													<Trash2 className="h-3.5 w-3.5" />
												</Button>
											</div>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* Staging Systems Tab */}
				<TabsContent value="staging">
					<Card>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
							<CardTitle className="text-lg">Staging Systems</CardTitle>
							<Button size="sm" onClick={openNewStaging}>
								<Plus className="h-4 w-4 mr-1" />
								Add
							</Button>
						</CardHeader>
						<CardContent>
							{stagingLoading ? (
								<LoadingSpinner />
							) : !stagingSystems || stagingSystems.length === 0 ? (
								<p className="text-sm text-muted-foreground text-center py-4">
									No staging systems yet. Add systems where doctrines should be staged.
								</p>
							) : (
								<div className="space-y-2">
									{stagingSystems.map((sys) => (
										<div
											key={sys.id}
											className="flex items-center justify-between rounded-md border px-3 py-2"
										>
											<div>
												<span className="font-medium">{sys.solarSystemName}</span>
												<span className="text-xs text-muted-foreground ml-2">
													(ID: {sys.solarSystemId}, order: {sys.sortOrder})
												</span>
											</div>
											<div className="flex gap-1">
												<Button
													variant="ghost"
													size="icon"
													className="h-7 w-7"
													onClick={() => openEditStaging(sys)}
												>
													<Edit className="h-3.5 w-3.5" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													className="h-7 w-7 text-destructive hover:text-destructive"
													onClick={() => handleDeleteStagingSystem(sys.id)}
												>
													<Trash2 className="h-3.5 w-3.5" />
												</Button>
											</div>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			{/* Dialogs */}
			<CategoryDialog
				key={editingCategory?.id ?? 'new-cat'}
				open={categoryDialogOpen}
				onOpenChange={setCategoryDialogOpen}
				category={editingCategory}
			/>
			<StagingSystemDialog
				key={editingStaging?.id ?? 'new-staging'}
				open={stagingDialogOpen}
				onOpenChange={setStagingDialogOpen}
				stagingSystem={editingStaging}
			/>
			{confirmationDialog}
		</Container>
	)
}
