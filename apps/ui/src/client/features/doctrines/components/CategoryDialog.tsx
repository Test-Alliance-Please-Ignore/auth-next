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
import toast from '@/lib/toast'

import { useCreateDoctrineCategory, useUpdateDoctrineCategory } from '../hooks'

import type { DoctrineCategory } from '../types'

interface CategoryDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	category?: DoctrineCategory
}

export function CategoryDialog({ open, onOpenChange, category }: CategoryDialogProps) {
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
