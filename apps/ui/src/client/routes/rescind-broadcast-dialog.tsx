import { Ban } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { useRescindBroadcast } from '@/hooks/useBroadcasts'

interface RescindBroadcastDialogProps {
	broadcastId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
	onError?: (error: Error) => void
}

export function RescindBroadcastDialog({
	broadcastId,
	open,
	onOpenChange,
	onSuccess,
	onError,
}: RescindBroadcastDialogProps) {
	const rescindBroadcast = useRescindBroadcast()
	const [rescindMessage, setRescindMessage] = useState('')

	const handleClose = () => {
		onOpenChange(false)
		setRescindMessage('')
	}

	const handleConfirm = async () => {
		try {
			await rescindBroadcast.mutateAsync({
				id: broadcastId,
				rescindMessage: rescindMessage.trim() || undefined,
			})
			handleClose()
			onSuccess?.()
		} catch (error) {
			handleClose()
			onError?.(error instanceof Error ? error : new Error('Failed to rescind broadcast'))
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rescind Broadcast</DialogTitle>
					<DialogDescription>
						This will edit the Discord message to display the content as strikethrough text and mark
						the broadcast as rescinded. This action cannot be undone.
					</DialogDescription>
				</DialogHeader>
				<div className="py-2">
					<label className="text-sm font-medium mb-1 block">
						Rescind message <span className="text-muted-foreground font-normal">(optional)</span>
					</label>
					<Textarea
						placeholder="Explain why this broadcast is being rescinded..."
						value={rescindMessage}
						onChange={(e) => setRescindMessage(e.target.value)}
						rows={3}
						disabled={rescindBroadcast.isPending}
					/>
					<p className="text-xs text-muted-foreground mt-1">
						Appended after the strikethrough content in Discord.
					</p>
				</div>
				<DialogFooter>
					<Button variant="cancel" onClick={handleClose} disabled={rescindBroadcast.isPending}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={handleConfirm}
						loading={rescindBroadcast.isPending}
						loadingText="Rescinding..."
						showIcon={false}
					>
						<Ban className="mr-2 h-4 w-4" />
						Rescind
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
