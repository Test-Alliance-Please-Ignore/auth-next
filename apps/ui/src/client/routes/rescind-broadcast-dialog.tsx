import { Ban } from 'lucide-react'
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
import { useRescindBroadcast } from '@/hooks/useBroadcasts'
import { formatNumber, useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import type { BroadcastWithDetails } from '@/lib/api'

interface RescindBroadcastDialogProps {
	broadcast?: BroadcastWithDetails
	broadcastId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
	onError?: (error: Error) => void
}

export function RescindBroadcastDialog({
	broadcast,
	broadcastId,
	open,
	onOpenChange,
	onSuccess,
	onError,
}: RescindBroadcastDialogProps) {
	const { t } = useAppTranslation()
	const messageId = useId()
	const rescindBroadcast = useRescindBroadcast()
	const [rescindMessage, setRescindMessage] = useState('')
	const remaining = broadcast
		? getBroadcastEditRemaining(broadcast, 'rescind', rescindMessage)
		: null
	const tooLong = remaining !== null && remaining < 0

	const handleClose = () => {
		onOpenChange(false)
		rescindBroadcast.reset()
		setRescindMessage('')
	}

	const handleConfirm = async () => {
		if (rescindBroadcast.isPending || !broadcastId || tooLong) return
		try {
			await rescindBroadcast.mutateAsync({
				id: broadcastId,
				rescindMessage: rescindMessage.trim() || undefined,
			})
			handleClose()
			if (onSuccess) onSuccess()
			else toast.success(<BroadcastFeedback messageKey="broadcasts.feedback.rescinded" />)
		} catch (error) {
			onError?.(error instanceof Error ? error : new Error(t('broadcasts.feedback.rescindFailed')))
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen && !rescindBroadcast.isPending) handleClose()
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('broadcasts.rescind.title')}</DialogTitle>
					<DialogDescription>{t('broadcasts.rescind.description')}</DialogDescription>
				</DialogHeader>
				<div className="py-2">
					<label htmlFor={messageId} className="text-sm font-medium mb-1 block">
						{t('broadcasts.rescind.label')}
					</label>
					<Textarea
						id={messageId}
						placeholder={t('broadcasts.rescind.placeholder')}
						value={rescindMessage}
						onChange={(e) => setRescindMessage(e.target.value)}
						rows={3}
						disabled={rescindBroadcast.isPending}
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
					<p className="text-xs text-muted-foreground mt-1">{t('broadcasts.rescind.help')}</p>
				</div>
				{rescindBroadcast.isError && (
					<p role="alert" className="text-sm text-destructive">
						<BroadcastFeedback
							messageKey="broadcasts.feedback.rescindFailed"
							error={rescindBroadcast.error}
						/>
					</p>
				)}
				<DialogFooter>
					<Button variant="cancel" onClick={handleClose} disabled={rescindBroadcast.isPending}>
						{t('common.cancel')}
					</Button>
					<Button
						variant="destructive"
						onClick={handleConfirm}
						disabled={tooLong}
						loading={rescindBroadcast.isPending}
						loadingText={t('broadcasts.rescind.pending')}
						showIcon={false}
					>
						<Ban className="h-4 w-4" />
						{t('broadcasts.rescind.action')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
