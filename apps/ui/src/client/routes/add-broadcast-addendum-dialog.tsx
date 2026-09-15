import { FilePlus2 } from 'lucide-react'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { BroadcastFeedback } from '@/features/broadcasts/components/broadcast-feedback'
import {
	DISCORD_MESSAGE_MAX_LENGTH,
	getBroadcastEditRemaining,
} from '@/features/broadcasts/message-edit-budget'
import { useAddBroadcastAddendum } from '@/hooks/useBroadcasts'
import { formatNumber, useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import type { BroadcastWithDetails } from '@/lib/api'

interface AddBroadcastAddendumDialogProps {
	broadcast?: BroadcastWithDetails
	broadcastId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
	onError?: (error: Error) => void
}

export function AddBroadcastAddendumDialog({
	broadcast,
	broadcastId,
	open,
	onOpenChange,
	onSuccess,
	onError,
}: AddBroadcastAddendumDialogProps) {
	const { t } = useAppTranslation()
	const messageId = useId()
	const addendum = useAddBroadcastAddendum()
	const [addendumMessage, setAddendumMessage] = useState('')
	const remaining = broadcast
		? getBroadcastEditRemaining(broadcast, 'addendum', addendumMessage)
		: null
	const tooLong = remaining !== null && remaining < 0

	const handleClose = () => {
		onOpenChange(false)
		addendum.reset()
		setAddendumMessage('')
	}

	const handleConfirm = async () => {
		if (addendum.isPending || !broadcastId || tooLong || addendumMessage.trim().length === 0) return
		try {
			await addendum.mutateAsync({
				id: broadcastId,
				addendumMessage: addendumMessage.trim(),
			})
			handleClose()
			if (onSuccess) onSuccess()
			else toast.success(<BroadcastFeedback messageKey="broadcasts.feedback.added" />)
		} catch (error) {
			onError?.(error instanceof Error ? error : new Error(t('broadcasts.feedback.addFailed')))
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen && !addendum.isPending) handleClose()
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('broadcasts.addendum.title')}</DialogTitle>
					<DialogDescription>{t('broadcasts.addendum.description')}</DialogDescription>
				</DialogHeader>
				<div className="py-2">
					<label htmlFor={messageId} className="text-sm font-medium mb-1 block">
						{t('broadcasts.addendum.label')}
					</label>
					<Textarea
						id={messageId}
						placeholder={t('broadcasts.addendum.placeholder')}
						value={addendumMessage}
						onChange={(e) => setAddendumMessage(e.target.value)}
						rows={4}
						disabled={addendum.isPending}
						maxLength={DISCORD_MESSAGE_MAX_LENGTH}
					/>
					{remaining !== null ? (
						<p className="text-xs mt-1">
							<span className={tooLong ? 'text-destructive' : 'text-muted-foreground'}>
								{t(tooLong ? 'broadcasts.overLimit' : 'broadcasts.remaining', {
									count: Math.max(0, remaining),
									formattedCount: formatNumber(Math.abs(remaining)),
								})}
							</span>
						</p>
					) : null}
					<p className="text-xs text-muted-foreground mt-1">{t('broadcasts.addendum.help')}</p>
				</div>
				{addendum.isError && (
					<p role="alert" className="text-sm text-destructive">
						<BroadcastFeedback messageKey="broadcasts.feedback.addFailed" error={addendum.error} />
					</p>
				)}
				<DialogFooter>
					<Button variant="cancel" onClick={handleClose} disabled={addendum.isPending}>
						{t('common.cancel')}
					</Button>
					<Button
						variant="confirm"
						onClick={handleConfirm}
						disabled={addendumMessage.trim().length === 0 || tooLong}
						loading={addendum.isPending}
						loadingText={t('broadcasts.addendum.adding')}
						showIcon={false}
					>
						<FilePlus2 className="h-4 w-4" />
						{t('broadcasts.addendum.action')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
