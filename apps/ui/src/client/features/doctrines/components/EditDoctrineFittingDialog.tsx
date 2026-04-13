/**
 * Edit Doctrine-Fitting Link Dialog
 *
 * Allows managers to change the category override and sort order
 * for a fitting within a specific doctrine.
 */

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import toast from '@/lib/toast'

import { useDoctrineCategories, useUpdateDoctrineFitting } from '../hooks'

import type { DoctrineFittingEntry } from '../types'

interface EditDoctrineFittingDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	doctrineId: string
	entry: DoctrineFittingEntry
}

export function EditDoctrineFittingDialog({
	open,
	onOpenChange,
	doctrineId,
	entry,
}: EditDoctrineFittingDialogProps) {
	const { data: categories } = useDoctrineCategories()
	const updateMutation = useUpdateDoctrineFitting()

	const [fittingCategory, setFittingCategory] = useState(
		entry.fittingCategory || entry.fitting.category || ''
	)
	const [sortOrder, setSortOrder] = useState(entry.sortOrder)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		try {
			await updateMutation.mutateAsync({
				doctrineId,
				fittingId: entry.fitting.id,
				data: {
					fittingCategory: fittingCategory || undefined,
					sortOrder,
				},
			})
			toast.success('Fitting link updated')
			onOpenChange(false)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to update')
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Edit: {entry.fitting.name}</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label>Category in Doctrine</Label>
							<Select
								options={(categories || []).map((c) => ({
									value: c.name,
									label: c.name,
								}))}
								value={fittingCategory}
								onValueChange={(val) => setFittingCategory(val)}
								placeholder="Select category..."
							/>
							<p className="text-xs text-muted-foreground">
								Override which category this fitting appears under in this doctrine
							</p>
						</div>
						<div className="space-y-2">
							<Label htmlFor="link-sort">Sort Order</Label>
							<Input
								id="link-sort"
								type="number"
								value={sortOrder}
								onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
								min="0"
								className="w-32"
							/>
							<p className="text-xs text-muted-foreground">
								Controls position within the category (lower = higher)
							</p>
						</div>
					</div>
					<DialogFooter>
						<Button variant="cancel" type="button" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button
							variant="confirm"
							type="submit"
							loading={updateMutation.isPending}
							loadingText="Saving..."
						>
							Update
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
