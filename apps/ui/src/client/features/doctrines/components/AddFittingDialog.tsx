/**
 * Add Fitting to Doctrine Dialog
 *
 * Lists available fittings and lets a manager add one to a doctrine
 */

import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { useAddFittingToDoctrine, useDoctrineCategories, useFittings } from '../hooks'
import { FittingListItem } from './FittingListItem'

interface AddFittingDialogProps {
	doctrineId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	existingFittingIds: string[]
}

export function AddFittingDialog({
	doctrineId,
	open,
	onOpenChange,
	existingFittingIds,
}: AddFittingDialogProps) {
	const { t } = useAppTranslation()

	const { data: allFittings, isLoading } = useFittings()
	const { data: categories } = useDoctrineCategories()
	const addMutation = useAddFittingToDoctrine()

	const [selectedFittingId, setSelectedFittingId] = useState<string | null>(null)
	const [sortOrder, setSortOrder] = useState(0)
	const [categoryOverride, setCategoryOverride] = useState('')
	const [search, setSearch] = useState('')

	const allAvailable = allFittings
		?.filter(
			(f) =>
				!existingFittingIds.includes(f.id) &&
				(search === '' ||
					f.name.toLowerCase().includes(search.toLowerCase()) ||
					f.shipName.toLowerCase().includes(search.toLowerCase()))
		)
		.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

	const totalAvailable = allAvailable?.length ?? 0
	const availableFittings = search === '' ? allAvailable?.slice(0, 10) : allAvailable

	const handleSelectFitting = (fittingId: string) => {
		setSelectedFittingId(fittingId)
		const fitting = allFittings?.find((f) => f.id === fittingId)
		if (fitting) {
			setCategoryOverride(fitting.category)
		}
	}

	const handleAdd = async () => {
		if (!selectedFittingId) return

		try {
			await addMutation.mutateAsync({
				doctrineId,
				fittingId: selectedFittingId,
				fittingCategory: categoryOverride || undefined,
				sortOrder,
			})
			toast.success(t('doctrines.fittingAddedToDoctrine'))
			// Reset state
			setSelectedFittingId(null)
			setSortOrder(0)
			setCategoryOverride('')
			setSearch('')
			onOpenChange(false)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('doctrines.failedToAddFitting'))
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{t('doctrines.addFitting')}</DialogTitle>
					<DialogDescription>{t('doctrines.selectAFittingToAddToThisDoctrine')}</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{/* Search fittings */}
					<div>
						<Label htmlFor="fitting-search">{t('doctrines.searchFittings')}</Label>
						<Input
							id="fitting-search"
							placeholder={t('doctrines.searchByShipOrFittingName')}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>

					{/* Fitting list */}
					{search === '' && totalAvailable > 10 && (
						<p className="text-xs text-muted-foreground">
							{t('doctrines.showing10Of')}
							{totalAvailable}
							{t('doctrines.searchToFindMore')}
						</p>
					)}

					<div className="max-h-48 overflow-y-auto border rounded-md">
						{isLoading ? (
							<div className="p-4 flex justify-center">
								<LoadingSpinner />
							</div>
						) : !availableFittings || availableFittings.length === 0 ? (
							<p className="p-4 text-sm text-muted-foreground text-center">
								{t('doctrines.noAvailableFittingsFound')}
							</p>
						) : (
							<div className="divide-y">
								{availableFittings.map((fitting) => (
									<FittingListItem
										key={fitting.id}
										shipTypeId={fitting.shipTypeId}
										shipName={fitting.shipName}
										name={fitting.name}
										category={fitting.category}
										selected={selectedFittingId === fitting.id}
										onClick={() => handleSelectFitting(fitting.id)}
									/>
								))}
							</div>
						)}
					</div>

					{/* Category override & sort order once fitting is selected */}
					{selectedFittingId && (
						<div className="flex gap-4">
							<div className="flex-1">
								<Label htmlFor="fitting-category">{t('doctrines.category')}</Label>
								<Select
									options={(categories || []).map((c) => ({
										value: c.name,
										label: c.name,
									}))}
									value={categoryOverride}
									onValueChange={(val) => setCategoryOverride(val)}
									placeholder={t('doctrines.selectCategory')}
								/>
							</div>
							<div className="w-32">
								<Label htmlFor="fitting-sort">{t('doctrines.sortOrder')}</Label>
								<Input
									id="fitting-sort"
									type="number"
									value={sortOrder}
									onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
								/>
							</div>
						</div>
					)}

					<Button
						className="w-full"
						disabled={!selectedFittingId || addMutation.isPending}
						loading={addMutation.isPending}
						loadingText={t('doctrines.adding')}
						onClick={handleAdd}
					>
						<Plus className="h-4 w-4" />
						{t('doctrines.addFitting')}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
