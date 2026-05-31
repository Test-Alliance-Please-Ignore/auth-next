import { Button } from './button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from './dialog'
import type { ButtonVariant } from './button'

export type ConfirmationIntent = 'confirm' | 'secondary' | 'destructive'

export type ConfirmationDialogProps = {
	open: boolean
	title: string
	description: string
	confirmLabel: string
	cancelLabel?: string
	intent?: ConfirmationIntent
	confirmButtonVariant?: ButtonVariant
	cancelButtonVariant?: ButtonVariant
	confirmDisabled?: boolean
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
	confirmButtonVariant,
	cancelButtonVariant,
	confirmDisabled = false,
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
					<Button
						variant={cancelButtonVariant ?? 'cancel'}
						showIcon={false}
						disabled={pending}
						onClick={onCancel}
					>
						{cancelLabel}
					</Button>
					<Button
						variant={confirmButtonVariant ?? confirmVariant}
						showIcon={false}
						disabled={pending || confirmDisabled}
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
