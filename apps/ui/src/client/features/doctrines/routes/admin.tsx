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
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import toast from '@/lib/toast'

import { CategoryDialog } from '../components/CategoryDialog'
import { FittingListItem } from '../components/FittingListItem'
import { StagingSystemDialog } from '../components/StagingSystemDialog'
import {
	useDeleteDoctrineCategory,
	useDeleteFitting,
	useDeleteStagingSystem,
	useDoctrineCategories,
	useFittingsWithDoctrines,
	useStagingSystems,
} from '../hooks'

import type { DoctrineCategory, StagingSystem } from '../types'

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
					<ArrowLeft className="h-4 w-4" />
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
								<p className="text-sm text-muted-foreground text-center py-4">No fittings found.</p>
							) : (
								<div className="space-y-2">
									{filteredFittings.map((fitting) => (
										<FittingListItem
											key={fitting.id}
											shipTypeId={fitting.shipTypeId}
											shipName={fitting.shipName}
											name={fitting.name}
											category={fitting.category}
											actions={
												<>
													<Button asChild variant="ghost" size="icon" className="h-7 w-7">
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
												</>
											}
										>
											{fitting.doctrines.length > 0 && (
												<div className="flex flex-wrap gap-1 ml-2">
													{fitting.doctrines.map((d) => (
														<Badge key={d.id} variant="secondary" className="text-xs">
															{d.name}
														</Badge>
													))}
												</div>
											)}
										</FittingListItem>
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
