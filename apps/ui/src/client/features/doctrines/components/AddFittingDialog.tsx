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
import toast from '@/lib/toast'

import { useAddFittingToDoctrine, useFittings } from '../hooks'
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
	const { data: allFittings, isLoading } = useFittings()
	const addMutation = useAddFittingToDoctrine()

	const [selectedFittingId, setSelectedFittingId] = useState<string | null>(null)
	const [sortOrder, setSortOrder] = useState(0)
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
	}

	const handleAdd = async () => {
		if (!selectedFittingId) return

		const selectedFitting = allFittings?.find((f) => f.id === selectedFittingId)

		try {
			await addMutation.mutateAsync({
				doctrineId,
				fittingId: selectedFittingId,
				fittingCategory: selectedFitting?.category,
				sortOrder,
			})
			toast.success('Fitting added to doctrine')
			// Reset state
			setSelectedFittingId(null)
			setSortOrder(0)
			setSearch('')
			onOpenChange(false)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to add fitting')
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Add Fitting</DialogTitle>
					<DialogDescription>Select a fitting to add to this doctrine.</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{/* Search fittings */}
					<div>
						<Label htmlFor="fitting-search">Search fittings</Label>
						<Input
							id="fitting-search"
							placeholder="Search by ship or fitting name..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>

					{/* Fitting list */}
					{search === '' && totalAvailable > 10 && (
						<p className="text-xs text-muted-foreground">
							Showing 10 of {totalAvailable} — search to find more
						</p>
					)}

					<div className="max-h-48 overflow-y-auto border rounded-md">
						{isLoading ? (
							<div className="p-4 flex justify-center">
								<LoadingSpinner />
							</div>
						) : !availableFittings || availableFittings.length === 0 ? (
							<p className="p-4 text-sm text-muted-foreground text-center">
								No available fittings found.
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

					{/* Sort order once fitting is selected */}
					{selectedFittingId && (
						<div className="w-32">
							<Label htmlFor="fitting-sort">Sort Order</Label>
							<Input
								id="fitting-sort"
								type="number"
								value={sortOrder}
								onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
							/>
						</div>
					)}

					<Button
						className="w-full"
						disabled={!selectedFittingId || addMutation.isPending}
						loading={addMutation.isPending}
						loadingText="Adding..."
						onClick={handleAdd}
					>
						<Plus className="h-4 w-4 mr-2" />
						Add Fitting
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
