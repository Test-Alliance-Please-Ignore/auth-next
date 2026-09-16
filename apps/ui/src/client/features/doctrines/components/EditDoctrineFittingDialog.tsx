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
import { useAppTranslation } from '@/i18n'
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
	const { t } = useAppTranslation()

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
			toast.success(t('doctrines.fittingLinkUpdated'))
			onOpenChange(false)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('doctrines.failedToUpdate'))
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>
							{t('doctrines.edit2')}
							{entry.fitting.name}
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label>{t('doctrines.categoryInDoctrine')}</Label>
							<Select
								options={(categories || []).map((c) => ({
									value: c.name,
									label: c.name,
								}))}
								value={fittingCategory}
								onValueChange={(val) => setFittingCategory(val)}
								placeholder={t('doctrines.selectCategory')}
							/>
							<p className="text-xs text-muted-foreground">
								{t('doctrines.overrideWhichCategoryThisFittingAppearsUnderInThisDoctrine')}
							</p>
						</div>
						<div className="space-y-2">
							<Label htmlFor="link-sort">{t('doctrines.sortOrder')}</Label>
							<Input
								id="link-sort"
								type="number"
								value={sortOrder}
								onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
								min="0"
								className="w-32"
							/>
							<p className="text-xs text-muted-foreground">
								{t('doctrines.controlsPositionWithinTheCategoryLowerHigher')}
							</p>
						</div>
					</div>
					<DialogFooter>
						<Button variant="cancel" type="button" onClick={() => onOpenChange(false)}>
							{t('doctrines.cancel')}
						</Button>
						<Button
							variant="confirm"
							type="submit"
							loading={updateMutation.isPending}
							loadingText={t('doctrines.saving')}
						>
							{t('doctrines.update')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
