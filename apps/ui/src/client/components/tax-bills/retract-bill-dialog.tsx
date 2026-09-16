import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useAppTranslation } from '@/i18n'

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
	const { t } = useAppTranslation()

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('tax.retractBill')}</DialogTitle>
					<DialogDescription>
						{t('tax.retractConfirm', { id: assessmentId ?? '-' })}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="cancel" showIcon={false} disabled={isPending} onClick={onClose}>
						{t('tax.cancel')}
					</Button>
					<Button
						variant="destructive"
						showIcon={false}
						disabled={
							!canIssue || !effectiveCorporationId || !assessmentId || !canRetract || isPending
						}
						onClick={onConfirm}
					>
						{isPending ? t('tax.retracting') : t('tax.retractBill')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
