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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUpdateGroup } from '@/hooks/useGroups'

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
					<DialogTitle>Edit Group Name</DialogTitle>
					<DialogDescription>
						Change the name of "{group.name}". This will be visible to all members.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="group-name">Group Name</Label>
						<Input
							id="group-name"
							value={groupName}
							onChange={(e) => setGroupName(e.target.value)}
							placeholder="Enter group name"
							disabled={updateGroup.isPending}
							maxLength={100}
						/>
						{isInvalid && (
							<p className="text-xs text-destructive">Group name cannot be empty</p>
						)}
					</div>
				</div>

				<DialogFooter>
					<CancelButton onClick={handleCancel} disabled={updateGroup.isPending}>
						Cancel
					</CancelButton>
					<ConfirmButton
						onClick={handleSave}
						loading={updateGroup.isPending}
						loadingText="Saving..."
						disabled={isUnchanged || isInvalid}
					>
						Save Changes
					</ConfirmButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
