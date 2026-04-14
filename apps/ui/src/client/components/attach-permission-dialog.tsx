import { Plus } from 'lucide-react'
import { useState } from 'react'

import { GlobalPermissionPicker } from '@/components/global-permission-picker'
import { PermissionTargetBadge } from '@/components/permission-target-badge'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

import type { AttachPermissionRequest, PermissionTarget } from '@/lib/api'

interface AttachPermissionDialogProps {
	groupId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onSubmit: (data: AttachPermissionRequest) => Promise<void>
	isSubmitting?: boolean
}

export function AttachPermissionDialog({
	groupId,
	open,
	onOpenChange,
	onSubmit,
	isSubmitting,
}: AttachPermissionDialogProps) {
	const [selectedPermissionId, setSelectedPermissionId] = useState<string>('')
	const [targetType, setTargetType] = useState<PermissionTarget>('all_members')

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!selectedPermissionId) return

		try {
			await onSubmit({
				groupId,
				permissionId: selectedPermissionId,
				targetType,
			})

			// Reset form
			setSelectedPermissionId('')
			setTargetType('all_members')
		} catch (error) {
			console.error('Failed to attach permission:', error)
		}
	}

	const handleCancel = () => {
		setSelectedPermissionId('')
		setTargetType('all_members')
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Attach Global Permission</DialogTitle>
					<DialogDescription>
						Select a global permission from the registry to attach to this group
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<GlobalPermissionPicker
						selectedPermissionId={selectedPermissionId}
						onSelectPermissionId={setSelectedPermissionId}
					/>

					{/* Target Type Selection */}
					<div className="space-y-2">
						<Label htmlFor="target-type">
							Attachment Type <span className="text-destructive">*</span>
						</Label>
						<Select
							value={targetType}
							onValueChange={(value) => setTargetType(value as PermissionTarget)}
							inputId="target-type"
							options={[
								{ value: 'all_members', label: 'All Members' },
								{ value: 'all_admins', label: 'All Admins' },
								{ value: 'owner_only', label: 'Owner Only' },
								{ value: 'owner_and_admins', label: 'Owner & Admins' },
							]}
						/>
						<p className="text-xs text-muted-foreground">
							Who in the group should receive this permission attachment?
						</p>
						<div className="pt-2">
							<PermissionTargetBadge target={targetType} />
						</div>
					</div>

					{/* Action Buttons */}
					<div className="flex justify-end gap-2 pt-4">
						<Button variant="cancel" type="button" onClick={handleCancel} disabled={isSubmitting}>
							Cancel
						</Button>
						<Button
							variant="confirm"
							type="submit"
							loading={isSubmitting}
							loadingText="Attaching..."
							disabled={!selectedPermissionId}
							showIcon={false}
						>
							<Plus className="h-4 w-4" />
							Attach Permission
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	)
}
