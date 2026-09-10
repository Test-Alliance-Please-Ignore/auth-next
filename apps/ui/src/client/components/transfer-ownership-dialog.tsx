import { AlertTriangle, UserCog } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Trans } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { useTransferOwnership } from '@/hooks/useGroups'
import { useAppTranslation } from '@/i18n'

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
	const { t } = useAppTranslation()
	const [selectedUserId, setSelectedUserId] = useState<string>('')
	const [errorMessage, setErrorMessage] = useState<Error | 'failed' | null>(null)
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

		setErrorMessage(null)
		try {
			await transferOwnership.mutateAsync({ groupId: group.id, newOwnerId: selectedUserId })
			setSelectedUserId('')
			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			console.error('Failed to transfer ownership:', error)
			if (error instanceof Error) {
				setErrorMessage(error)
			} else {
				setErrorMessage('failed')
			}
		}
	}

	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) {
			setSelectedUserId('')
			setErrorMessage(null)
		}
		onOpenChange(newOpen)
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<UserCog className="h-5 w-5" />
						{t('groupDetail.transfer.title')}
					</DialogTitle>
					<DialogDescription>
						<Trans
							i18nKey="groupDetail.transfer.dialogDescription"
							values={{ group: group.name }}
							components={{ strong: <strong /> }}
						/>
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{/* Member Selection */}
					<div className="space-y-2">
						<label htmlFor="group-new-owner" className="text-sm font-medium">
							{t('groupDetail.transfer.newOwner')}
						</label>
						<Select
							inputId="group-new-owner"
							value={selectedUserId}
							onValueChange={setSelectedUserId}
							options={eligibleMembers.map((member) => ({
								value: member.userId,
								label: member.mainCharacterName || t('groupDetail.unknownUser'),
							}))}
							placeholder={t('groupDetail.transfer.selectMember')}
						/>
					</div>

					{/* Error Message */}
					{errorMessage && (
						<div className="rounded-md border border-destructive bg-destructive/10 p-3">
							<p className="text-sm text-destructive">
								{errorMessage instanceof Error
									? errorMessage.message
									: t('groupDetail.transfer.failed')}
							</p>
						</div>
					)}

					{/* Warning Message */}
					{selectedMember && (
						<div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
							<div className="flex gap-2">
								<AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
								<div className="text-sm space-y-1">
									<p className="font-medium text-amber-700 dark:text-amber-400">
										{t('groupDetail.transfer.whatHappens')}
									</p>
									<ul className="list-disc list-inside text-muted-foreground space-y-1">
										<li>
											<Trans
												i18nKey="groupDetail.transfer.newOwnerOutcome"
												values={{
													name: selectedMember.mainCharacterName || t('groupDetail.unknownUser'),
												}}
												components={{ strong: <strong /> }}
											/>
										</li>
										<li>{t('groupDetail.transfer.currentOwnerOutcome')}</li>
										<li>{t('groupDetail.transfer.controlOutcome')}</li>
										<li>{t('groupDetail.transfer.irreversibleOutcome')}</li>
									</ul>
								</div>
							</div>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button
						variant="cancel"
						onClick={() => handleOpenChange(false)}
						disabled={transferOwnership.isPending}
					>
						{t('common.cancel')}
					</Button>
					<Button
						variant="confirm"
						onClick={handleTransfer}
						disabled={!selectedUserId}
						loading={transferOwnership.isPending}
						loadingText={t('groupDetail.transfer.transferring')}
						showIcon={false}
					>
						<UserCog className="h-4 w-4" />
						{t('groupDetail.transfer.title')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
