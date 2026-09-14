import { useNavigate, useParams } from 'react-router'

import { isManualBill } from '@repo/bills'

import { BillDetailContent, BillDetailState } from '@/components/bills/bill-detail-content'
import { BillFeedback } from '@/components/bills/bill-feedback'
import { useAuth } from '@/hooks/useAuth'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'
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
	const { t } = useAppTranslation()
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

	usePageTitle(bill ? t('bills.pageTitle', { title: bill.title }) : t('bills.details'))

	const handleIssue = async () => {
		if (!bill) return
		try {
			await issueBill.mutateAsync(bill.id)
		} catch (error) {
			toast.error(<BillFeedback messageKey="bills.feedback.issueFailed" error={error} />)
		}
	}

	const handleCancel = () => {
		if (!bill) return
		requestConfirmation({
			title: (t) => t('bills.confirm.cancelTitle'),
			description: (t) => t('bills.confirm.cancelDescription'),
			confirmLabel: (t) => t('bills.confirm.cancelTitle'),
			intent: 'confirm',
			onConfirm: async () => {
				try {
					await cancelBill.mutateAsync(bill.id)
				} catch (error) {
					toast.error(<BillFeedback messageKey="bills.feedback.cancelFailed" error={error} />)
					throw error
				}
			},
		})
	}

	const handleMarkPaid = () => {
		if (!bill) return
		requestConfirmation({
			title: (t) => t('bills.confirm.paidTitle'),
			description: (t) => t('bills.confirm.paidDescription'),
			confirmLabel: (t) => t('bills.actions.markPaid'),
			intent: 'confirm',
			onConfirm: async () => {
				try {
					await markBillPaid.mutateAsync(bill.id)
				} catch (error) {
					toast.error(<BillFeedback messageKey="bills.feedback.paidFailed" error={error} />)
					throw error
				}
			},
		})
	}

	const handleRevertToDraft = () => {
		if (!bill) return
		requestConfirmation({
			title: (t) => t('bills.confirm.draftTitle'),
			description: (t) => t('bills.confirm.draftDescription'),
			confirmLabel: (t) => t('bills.actions.draft'),
			intent: 'secondary',
			onConfirm: async () => {
				try {
					await revertBillToDraft.mutateAsync(bill.id)
				} catch (error) {
					toast.error(<BillFeedback messageKey="bills.feedback.draftFailed" error={error} />)
					throw error
				}
			},
		})
	}

	const handleDelete = () => {
		if (!bill) return
		requestConfirmation({
			title: (t) => t('bills.confirm.deleteTitle'),
			description: (t) => t('bills.confirm.deleteDescription'),
			confirmLabel: (t) => t('bills.confirm.deleteTitle'),
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteBill.mutateAsync(bill.id)
					void navigate('/my-bills')
				} catch (error) {
					toast.error(<BillFeedback messageKey="bills.feedback.deleteFailed" error={error} />)
					throw error
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
								pending:
									issueBill.isPending ||
									cancelBill.isPending ||
									markBillPaid.isPending ||
									deleteBill.isPending ||
									revertBillToDraft.isPending,
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
