import { ArrowRight } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useCategories } from '@/hooks/useCategories'
import { useUpdateGroup } from '@/hooks/useGroups'
import { useAppTranslation } from '@/i18n'

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
	const { t } = useAppTranslation()
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
					<DialogTitle>{t('admin.organizations.group.reassignTitle')}</DialogTitle>
					<DialogDescription>
						{t('admin.organizations.group.reassignDescription', { name: group.name })}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{updateGroup.error && (
						<p role="alert" className="text-sm text-destructive">
							{updateGroup.error instanceof Error
								? updateGroup.error.message
								: t('admin.organizations.group.reassignError')}
						</p>
					)}

					{/* Current Category Display */}
					<div className="rounded-lg border bg-muted/50 p-3">
						<p className="text-xs text-muted-foreground mb-1">
							{t('admin.organizations.group.currentCategory')}
						</p>
						<p className="text-sm font-medium">
							{currentCategory?.name || t('admin.users.account.unknown')}
						</p>
					</div>

					{/* Category Selector */}
					<div className="space-y-2">
						<Label htmlFor="category-select">{t('admin.organizations.group.newCategory')}</Label>
						<Select
							value={selectedCategoryId}
							onValueChange={setSelectedCategoryId}
							inputId="category-select"
							options={categories.map((category) => ({ value: category.id, label: category.name }))}
							placeholder={t('groups.form.selectCategory')}
							disabled={categoriesLoading || updateGroup.isPending}
						/>
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
					<Button variant="cancel" onClick={handleCancel} disabled={updateGroup.isPending}>
						{t('common.cancel')}
					</Button>
					<Button
						variant="confirm"
						onClick={handleReassign}
						loading={updateGroup.isPending}
						loadingText={t('admin.organizations.group.reassigning')}
						disabled={isSameCategory}
					>
						{t('admin.organizations.group.reassignCategory')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
