import { X } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Label } from '../../../components/ui/label'
import { Select } from '../../../components/ui/select'
import { Skeleton } from '../../../components/ui/skeleton'
import { useSkillPlanCategories } from '../hooks'

interface CategorySelectorProps {
	value: string[] | undefined
	onChange: (value: string[]) => void
	disabled?: boolean
}

export function CategorySelector({ value = [], onChange, disabled }: CategorySelectorProps) {
	const { data: categories, isLoading } = useSkillPlanCategories()
	const [selectedCategoryId, setSelectedCategoryId] = useState<string>('')

	const handleAddCategory = () => {
		if (selectedCategoryId && !value.includes(selectedCategoryId)) {
			onChange([...value, selectedCategoryId])
			setSelectedCategoryId('')
		}
	}

	const handleRemoveCategory = (categoryId: string) => {
		onChange(value.filter((id) => id !== categoryId))
	}

	// Get category names for display
	const getCategoryName = (categoryId: string) => {
		const category = categories?.find((c) => c.id === categoryId)
		return category?.name || 'Unknown Category'
	}

	// Filter out already selected categories from dropdown
	const availableCategories = categories?.filter((category) => !value.includes(category.id)) || []

	if (isLoading) {
		return (
			<div className="space-y-2">
				<Label>Categories</Label>
				<Skeleton className="h-10 w-full" />
			</div>
		)
	}

	return (
		<div className="space-y-2">
			<Label>Categories</Label>
			<p className="text-sm text-muted-foreground">
				Organize your skill plan by adding it to categories
			</p>

			{/* Add category selector */}
			{availableCategories.length > 0 && (
				<div className="flex gap-2">
					<Select
						value={selectedCategoryId}
						onValueChange={setSelectedCategoryId}
						options={availableCategories.map((category) => ({ value: category.id,
							label: category.name,
						}))}
						placeholder="Select a category to add"
						className="flex-1"
						disabled={disabled}
					/>
					<Button
						type="button"
						onClick={handleAddCategory}
						disabled={!selectedCategoryId || disabled}
					>
						Add
					</Button>
				</div>
			)}

			{/* Display selected categories */}
			{value.length > 0 && (
				<div className="flex flex-wrap gap-2 mt-2">
					{value.map((categoryId) => (
						<Badge key={categoryId} variant="secondary" className="flex items-center gap-1">
							{getCategoryName(categoryId)}
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-4 w-4 p-0 hover:bg-transparent"
								onClick={() => handleRemoveCategory(categoryId)}
								disabled={disabled}
							>
								<X className="h-3 w-3" />
							</Button>
						</Badge>
					))}
				</div>
			)}

			{value.length === 0 && availableCategories.length === 0 && (
				<p className="text-sm text-muted-foreground italic">
					No categories available. Categories can be created by admins.
				</p>
			)}
		</div>
	)
}
