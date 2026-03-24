import { CancelButton } from './cancel-button'
import { ConfirmButton } from './confirm-button'
import { DestructiveButton } from './destructive-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from './dialog'
import { SecondaryButton } from './secondary-button'

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
	const confirmAction =
		intent === 'destructive' ? (
			<DestructiveButton showIcon={false} disabled={pending} loading={pending} onClick={onConfirm}>
				{confirmLabel}
			</DestructiveButton>
		) : intent === 'secondary' ? (
			<SecondaryButton disabled={pending} loading={pending} onClick={onConfirm}>
				{confirmLabel}
			</SecondaryButton>
		) : (
			<ConfirmButton showIcon={false} disabled={pending} loading={pending} onConfirm={onConfirm}>
				{confirmLabel}
			</ConfirmButton>
		)

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<CancelButton showIcon={false} disabled={pending} onClick={onCancel}>
						{cancelLabel}
					</CancelButton>
					{confirmAction}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
