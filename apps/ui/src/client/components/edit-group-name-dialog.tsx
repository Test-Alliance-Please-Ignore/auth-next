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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUpdateGroup } from '@/hooks/useGroups'
import { useAppTranslation } from '@/i18n'

import type { GroupWithDetails } from '@/lib/api'

interface EditGroupNameDialogProps {
	group: GroupWithDetails
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
}

export function EditGroupNameDialog({
	group,
	open,
	onOpenChange,
	onSuccess,
}: EditGroupNameDialogProps) {
	const { t } = useAppTranslation()
	const [groupName, setGroupName] = useState<string>(group.name)
	const updateGroup = useUpdateGroup()

	const handleSave = async () => {
		const trimmedName = groupName.trim()

		if (!trimmedName || trimmedName === group.name) {
			return
		}

		try {
			await updateGroup.mutateAsync({
				id: group.id,
				data: { name: trimmedName },
			})
			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			console.error('Failed to update group name:', error)
		}
	}

	const handleCancel = () => {
		setGroupName(group.name)
		onOpenChange(false)
	}

	const isUnchanged = groupName.trim() === group.name
	const isInvalid = !groupName.trim()

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('groups.edit.nameTitle')}</DialogTitle>
					<DialogDescription>
						{t('groups.edit.nameDescription', { name: group.name })}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="group-name">{t('groups.groupName')}</Label>
						<Input
							id="group-name"
							value={groupName}
							onChange={(e) => setGroupName(e.target.value)}
							placeholder={t('groups.form.namePlaceholder')}
							disabled={updateGroup.isPending}
							maxLength={100}
						/>
						{isInvalid && <p className="text-xs text-destructive">{t('groups.edit.nameEmpty')}</p>}
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
						disabled={isUnchanged || isInvalid}
					>
						{t('groups.edit.save')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
