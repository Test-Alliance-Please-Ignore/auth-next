import { CancelButton } from '@/components/ui/cancel-button'
import { DestructiveButton } from '@/components/ui/destructive-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'

type RetractBillDialogProps = {
	open: boolean
	assessmentId: string | null
	canIssue: boolean
	effectiveCorporationId: string | null
	canRetract: boolean
	isPending: boolean
	onClose: () => void
	onConfirm: () => void
}

export function RetractBillDialog({
	open,
	assessmentId,
	canIssue,
	effectiveCorporationId,
	canRetract,
	isPending,
	onClose,
	onConfirm,
}: RetractBillDialogProps) {
	return (
		<Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Retract Bill</DialogTitle>
					<DialogDescription>
						This will cancel the linked bill for assessment{' '}
						<span className="font-mono text-xs">{assessmentId ?? '-'}</span>.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<CancelButton showIcon={false} disabled={isPending} onClick={onClose}>
						Cancel
					</CancelButton>
					<DestructiveButton
						showIcon={false}
						disabled={
							!canIssue || !effectiveCorporationId || !assessmentId || !canRetract || isPending
						}
						onClick={onConfirm}
					>
						{isPending ? 'Retracting...' : 'Retract Bill'}
					</DestructiveButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
