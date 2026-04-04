import { Button } from './button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from './dialog'

export type ConfirmationIntent = 'confirm' | 'secondary' | 'destructive'

export type ConfirmationDialogProps = {
	open: boolean
	title: string
	description: string
	confirmLabel: string
	cancelLabel?: string
	intent?: ConfirmationIntent
	pending?: boolean
	onCancel: () => void
	onConfirm: () => void
}

export function ConfirmationDialog({
	open,
	title,
	description,
	confirmLabel,
	cancelLabel = 'Cancel',
	intent = 'confirm',
	pending = false,
	onCancel,
	onConfirm,
}: ConfirmationDialogProps) {
	const confirmVariant =
		intent === 'destructive' ? 'destructive' : intent === 'secondary' ? 'secondary' : 'confirm'

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="cancel" showIcon={false} disabled={pending} onClick={onCancel}>
						{cancelLabel}
					</Button>
					<Button
						variant={confirmVariant}
						showIcon={false}
						disabled={pending}
						loading={pending}
						onClick={onConfirm}
					>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
