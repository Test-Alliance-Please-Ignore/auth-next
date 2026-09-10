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
import { Textarea } from '@/components/ui/textarea'
import { useUpdateGroup } from '@/hooks/useGroups'
import { formatNumber, useAppTranslation } from '@/i18n'

import type { GroupWithDetails } from '@/lib/api'

interface EditGroupDescriptionDialogProps {
	group: GroupWithDetails
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
}

export function EditGroupDescriptionDialog({
	group,
	open,
	onOpenChange,
	onSuccess,
}: EditGroupDescriptionDialogProps) {
	const { t } = useAppTranslation()
	const [description, setDescription] = useState<string>(group.description || '')
	const updateGroup = useUpdateGroup()

	const handleSave = async () => {
		const trimmedDescription = description.trim()

		// Allow empty description (to clear it)
		if (trimmedDescription === (group.description || '')) {
			return
		}

		try {
			await updateGroup.mutateAsync({
				id: group.id,
				data: { description: trimmedDescription || undefined },
			})
			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			console.error('Failed to update group description:', error)
		}
	}

	const handleCancel = () => {
		setDescription(group.description || '')
		onOpenChange(false)
	}

	const isUnchanged = description.trim() === (group.description || '')

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('groups.edit.descriptionTitle')}</DialogTitle>
					<DialogDescription>
						{t('groups.edit.descriptionDescription', { name: group.name })}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="group-description">{t('groups.form.description')}</Label>
						<Textarea
							id="group-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={t('groups.form.descriptionPlaceholder')}
							disabled={updateGroup.isPending}
							rows={5}
							maxLength={500}
						/>
						<p className="text-xs text-muted-foreground">
							{t('groups.edit.characterCount', {
								current: formatNumber(description.length),
								maximum: formatNumber(500),
							})}
						</p>
					</div>
				</div>

				<DialogFooter>
					<Button variant="cancel" onClick={handleCancel} disabled={updateGroup.isPending}>
						{t('common.cancel')}
					</Button>
					<Button
						variant="confirm"
						onClick={handleSave}
						loading={updateGroup.isPending}
						loadingText={t('groups.edit.saving')}
						disabled={isUnchanged}
					>
						{t('groups.edit.save')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
