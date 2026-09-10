import { useNavigate, useParams } from 'react-router'

import { isManualBill } from '@repo/bills'

import { BillDetailContent, BillDetailState } from '@/components/bills/bill-detail-content'
import { useAuth } from '@/hooks/useAuth'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import toast from '@/lib/toast'

import {
	useBill,
	useCancelIssuedBill,
	useDeleteIssuedBill,
	useIssueIssuedBill,
	useMarkIssuedBillPaid,
	useRevertIssuedBillToDraft,
} from '../hooks'
import { hasBillingIssuerPermission } from '../issuer-access'

export default function BillDetailPage() {
	const { billId } = useParams<{ billId: string }>()
	const navigate = useNavigate()
	const { user } = useAuth()
	const { permissions, isAdmin } = useUserPermissions()
	const { data: bill, isLoading, error } = useBill(billId ?? '')
	const issueBill = useIssueIssuedBill()
	const cancelBill = useCancelIssuedBill()
	const markBillPaid = useMarkIssuedBillPaid()
	const deleteBill = useDeleteIssuedBill()
	const revertBillToDraft = useRevertIssuedBillToDraft()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

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
					void navigate('/my-bills')
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
					backHref="/my-bills"
				/>
			</>
		)
	}

	const canIssueBills = hasBillingIssuerPermission(permissions, isAdmin)
	const canManage = canIssueBills && user?.id === bill.issuerId && isManualBill(bill)
	const canMarkPaid = canIssueBills && bill.canMarkPaid === true
	const canRevertToDraft = bill.canRevertToDraft === true

	return (
		<>
			{confirmationDialog}
			<BillDetailContent
				bill={bill}
				backHref="/my-bills"
				actions={
					canManage || canMarkPaid
						? {
								onIssue: canManage ? () => void handleIssue() : undefined,
								onMarkPaid: canMarkPaid ? handleMarkPaid : undefined,
								onRevertToDraft: canManage && canRevertToDraft ? handleRevertToDraft : undefined,
								canRevertToDraft,
								onCancel: canManage ? handleCancel : undefined,
								onDelete: canManage ? handleDelete : undefined,
							}
						: undefined
				}
			/>
		</>
	)
}
