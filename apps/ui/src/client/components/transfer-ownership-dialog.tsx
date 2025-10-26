import { AlertTriangle, UserCog } from 'lucide-react'
import { useEffect, useState } from 'react'

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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { useTransferOwnership } from '@/hooks/useGroups'

import type { GroupMember, GroupWithDetails } from '@/lib/api'

interface TransferOwnershipDialogProps {
	group: GroupWithDetails
	members: GroupMember[]
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
	initialSelectedUserId?: string
}

export function TransferOwnershipDialog({
	group,
	members,
	open,
	onOpenChange,
	onSuccess,
	initialSelectedUserId,
}: TransferOwnershipDialogProps) {
	const [selectedUserId, setSelectedUserId] = useState<string>('')
	const transferOwnership = useTransferOwnership()

	// Sync internal state when dialog opens with a pre-selected user
	useEffect(() => {
		if (open && initialSelectedUserId) {
			setSelectedUserId(initialSelectedUserId)
		}
	}, [open, initialSelectedUserId])

	// Filter out current owner from member list
	const eligibleMembers = members.filter((member) => member.userId !== group.ownerId)

	const selectedMember = members.find((m) => m.userId === selectedUserId)

	const handleTransfer = async () => {
		if (!selectedUserId) return

		try {
			await transferOwnership.mutateAsync({ groupId: group.id, newOwnerId: selectedUserId })
			setSelectedUserId('')
			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			console.error('Failed to transfer ownership:', error)
			if (error instanceof Error) {
				alert(error.message)
			}
		}
	}

	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) {
			setSelectedUserId('')
		}
		onOpenChange(newOpen)
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<UserCog className="h-5 w-5" />
						Transfer Ownership
					</DialogTitle>
					<DialogDescription>
						Transfer ownership of <strong>{group.name}</strong> to another member. This action
						cannot be undone.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{/* Member Selection */}
					<div className="space-y-2">
						<label className="text-sm font-medium">New Owner</label>
						<Select value={selectedUserId} onValueChange={setSelectedUserId}>
							<SelectTrigger>
								<SelectValue placeholder="Select a member..." />
							</SelectTrigger>
							<SelectContent>
								{eligibleMembers.map((member) => (
									<SelectItem key={member.userId} value={member.userId}>
										{member.mainCharacterName || 'Unknown User'}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{/* Warning Message */}
					{selectedMember && (
						<div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
							<div className="flex gap-2">
								<AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
								<div className="text-sm space-y-1">
									<p className="font-medium text-amber-700 dark:text-amber-400">
										What will happen:
									</p>
									<ul className="list-disc list-inside text-muted-foreground space-y-1">
										<li>
											<strong>{selectedMember.mainCharacterName}</strong> will become the new owner
										</li>
										<li>You will be automatically made a group admin</li>
										<li>The new owner will have full control over the group</li>
										<li>This change cannot be undone (you must ask them to transfer back)</li>
									</ul>
								</div>
							</div>
						</div>
					)}
				</div>

				<DialogFooter>
					<CancelButton onClick={() => handleOpenChange(false)} disabled={transferOwnership.isPending}>
						Cancel
					</CancelButton>
					<ConfirmButton
						onClick={handleTransfer}
						disabled={!selectedUserId}
						loading={transferOwnership.isPending}
						loadingText="Transferring..."
						showIcon={false}
					>
						<UserCog className="mr-2 h-4 w-4" />
						Transfer Ownership
					</ConfirmButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
