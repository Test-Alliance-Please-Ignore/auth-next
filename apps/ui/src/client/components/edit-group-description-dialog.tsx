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
import { Textarea } from '@/components/ui/textarea'
import { useUpdateGroup } from '@/hooks/useGroups'

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
					<DialogTitle>Edit Group Description</DialogTitle>
					<DialogDescription>
						Update the description for "{group.name}". This will be visible to all members.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="group-description">Description</Label>
						<Textarea
							id="group-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Enter group description (optional)"
							disabled={updateGroup.isPending}
							rows={5}
							maxLength={500}
						/>
						<p className="text-xs text-muted-foreground">
							{description.length}/500 characters
						</p>
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
						disabled={isUnchanged}
					>
						Save Changes
					</ConfirmButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
