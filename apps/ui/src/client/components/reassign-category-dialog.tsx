import { ArrowRight } from 'lucide-react'
import { useState } from 'react'

import { CancelButton } from '@/components/ui/cancel-button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { useCategories } from '@/hooks/useCategories'
import { useUpdateGroup } from '@/hooks/useGroups'

import type { GroupWithDetails } from '@/lib/api'

interface ReassignCategoryDialogProps {
	group: GroupWithDetails
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
}

export function ReassignCategoryDialog({
	group,
	open,
	onOpenChange,
	onSuccess,
}: ReassignCategoryDialogProps) {
	const [selectedCategoryId, setSelectedCategoryId] = useState<string>(group.categoryId)
	const { data: categories = [], isLoading: categoriesLoading } = useCategories()
	const updateGroup = useUpdateGroup()

	const handleReassign = async () => {
		if (selectedCategoryId === group.categoryId) {
			return
		}

		try {
			await updateGroup.mutateAsync({
				id: group.id,
				data: { categoryId: selectedCategoryId },
			})
			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			console.error('Failed to reassign category:', error)
		}
	}

	const handleCancel = () => {
		setSelectedCategoryId(group.categoryId)
		onOpenChange(false)
	}

	const currentCategory = categories.find((c) => c.id === group.categoryId)
	const selectedCategory = categories.find((c) => c.id === selectedCategoryId)
	const isSameCategory = selectedCategoryId === group.categoryId

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Reassign Group Category</DialogTitle>
					<DialogDescription>
						Move "{group.name}" to a different category. This will affect how the group is organized
						and displayed.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{/* Current Category Display */}
					<div className="rounded-lg border bg-muted/50 p-3">
						<p className="text-xs text-muted-foreground mb-1">Current Category</p>
						<p className="text-sm font-medium">{currentCategory?.name || 'Unknown'}</p>
					</div>

					{/* Category Selector */}
					<div className="space-y-2">
						<Label htmlFor="category-select">New Category</Label>
						<Select
							value={selectedCategoryId}
							onValueChange={setSelectedCategoryId}
							disabled={categoriesLoading || updateGroup.isPending}
						>
							<SelectTrigger id="category-select">
								<SelectValue placeholder="Select a category" />
							</SelectTrigger>
							<SelectContent>
								{categories.map((category) => (
									<SelectItem key={category.id} value={category.id}>
										{category.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{/* Preview of Change */}
					{!isSameCategory && selectedCategory && currentCategory && (
						<div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
							<div className="flex items-center gap-2 text-sm">
								<span className="font-medium">{currentCategory.name}</span>
								<ArrowRight className="h-4 w-4 text-muted-foreground" />
								<span className="font-medium text-primary">{selectedCategory.name}</span>
							</div>
						</div>
					)}
				</div>

				<DialogFooter>
					<CancelButton onClick={handleCancel} disabled={updateGroup.isPending}>
						Cancel
					</CancelButton>
					<ConfirmButton
						onClick={handleReassign}
						loading={updateGroup.isPending}
						loadingText="Reassigning..."
						disabled={isSameCategory}
					>
						Reassign Category
					</ConfirmButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
