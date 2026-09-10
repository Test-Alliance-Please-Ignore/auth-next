import { useNavigate, useParams } from 'react-router'

import { BillDetailContent, BillDetailState } from '@/components/bills/bill-detail-content'
import {
	useBill,
	useCancelBill,
	useDeleteBill,
	useIssueBill,
	useMarkBillPaid,
	useRevertBillToDraft,
} from '@/hooks/useBills'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import toast from '@/lib/toast'

export default function AdminBillsDetailPage() {
	const { billId } = useParams<{ billId: string }>()
	const navigate = useNavigate()
	const issueBill = useIssueBill()
	const cancelBill = useCancelBill()
	const markBillPaid = useMarkBillPaid()
	const deleteBill = useDeleteBill()
	const revertBillToDraft = useRevertBillToDraft()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const { data: bill, isLoading, error } = useBill(billId ?? '')
	usePageTitle(bill ? `Bill - ${bill.title}` : 'Bill Details')

	const handleIssue = async () => {
		if (!bill) return
		try {
			await issueBill.mutateAsync(bill.id)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to issue bill')
		}
	}

	const handleCancel = () => {
		if (!bill) return
		requestConfirmation({
			title: 'Cancel Bill',
			description: 'Are you sure you want to cancel this bill?',
			confirmLabel: 'Cancel Bill',
			intent: 'confirm',
			onConfirm: async () => {
				try {
					await cancelBill.mutateAsync(bill.id)
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Failed to cancel bill')
				}
			},
		})
	}

	const handleMarkPaid = () => {
		if (!bill) return
		requestConfirmation({
			title: 'Mark Bill Paid',
			description: 'Mark this bill as paid?',
			confirmLabel: 'Mark Paid',
			intent: 'confirm',
			onConfirm: async () => {
				try {
					await markBillPaid.mutateAsync(bill.id)
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Failed to mark bill paid')
				}
			},
		})
	}

	const handleRevertToDraft = () => {
		if (!bill) return
		requestConfirmation({
			title: 'Move Bill To Draft',
			description: 'Move this bill back to draft?',
			confirmLabel: 'To Draft',
			intent: 'secondary',
			onConfirm: async () => {
				try {
					await revertBillToDraft.mutateAsync(bill.id)
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Failed to revert bill to draft')
				}
			},
		})
	}

	const handleDelete = () => {
		if (!bill) return
		requestConfirmation({
			title: 'Delete Bill',
			description: 'Are you sure you want to delete this bill? This action cannot be undone.',
			confirmLabel: 'Delete Bill',
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteBill.mutateAsync(bill.id)
					void navigate('/admin/bills')
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Failed to delete bill')
				}
			},
		})
	}

	if (!bill) {
		return (
			<>
				{confirmationDialog}
				<BillDetailState
					isLoading={isLoading}
					error={error ?? (!isLoading ? new Error('Not found') : null)}
					backHref="/admin/bills"
				/>
			</>
		)
	}

	return (
		<>
			{confirmationDialog}
			<BillDetailContent
				bill={bill}
				backHref="/admin/bills"
				actions={{
					onIssue: () => void handleIssue(),
					onMarkPaid: handleMarkPaid,
					onRevertToDraft: handleRevertToDraft,
					canRevertToDraft: bill.canRevertToDraft === true,
					onCancel: handleCancel,
					onDelete: handleDelete,
					editHref: `/admin/bills/${bill.id}/edit`,
				}}
			/>
		</>
	)
}
