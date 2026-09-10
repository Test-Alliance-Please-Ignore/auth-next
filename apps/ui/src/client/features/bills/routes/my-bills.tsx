import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { getBillingIssuerScopeFromUrns, isManualBill } from '@repo/bills'

import { BillActionsMenu } from '@/components/bills/bill-actions-menu'
import {
	getDefaultBillDueAfter,
	readBillingFilterSession,
	writeBillingFilterSession,
} from '@/components/bills/bill-filter-session'
import { BillListFilters } from '@/components/bills/bill-list-filters'
import { BillListGrid } from '@/components/bills/bill-list-grid'
import { useLayoutScrollMode } from '@/components/layout-scroll-context'
import { TableLayoutToggle } from '@/components/table-layout-toggle'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/hooks/useAuth'
import {
	useCancelGroupBill,
	useDeleteGroupBill,
	useIssueGroupBill,
	useRevertGroupBillToDraft,
} from '@/hooks/useBills'
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import toast from '@/lib/toast'
import { cn } from '@/lib/utils'

import {
	useCancelIssuedBill,
	useDeleteIssuedBill,
	useIssueIssuedBill,
	useMarkIssuedBillPaid,
	useMyBillPartySearch,
	useMyBills,
	useRevertIssuedBillToDraft,
} from '../hooks'
import { hasBillingIssuerPermission } from '../issuer-access'

import type { BillListSortField, BillStatus, BillWithDetails, EntityType } from '@repo/bills'
import type { BillActionItem } from '@/components/bills/bill-actions-menu'
import type { BillListSortingState } from '@/components/bills/bill-list-types'

export default function MyBillsPage() {
	usePageTitle('Bills')
	const { permissions, isAdmin } = useUserPermissions()
	const canIssueBills = hasBillingIssuerPermission(permissions, isAdmin)
	const { isPageScrollEnabled, setIsPageScrollEnabled } = useLayoutScrollMode()
	const isTableGridClamped = !isPageScrollEnabled
	const [savedFilters] = useState(() =>
		readBillingFilterSession('mine', {
			issuerQuery: '',
			payerQuery: '',
			payeeQuery: '',
			dueAfter: getDefaultBillDueAfter(),
			dueBefore: '',
		})
	)
	const [status, setStatus] = useState<BillStatus | undefined>(savedFilters.status)
	const [payerType, setPayerType] = useState<EntityType | undefined>(savedFilters.payerType)
	const [payeeType, setPayeeType] = useState<EntityType | undefined>(savedFilters.payeeType)
	const [payerId, setPayerId] = useState<string | undefined>(savedFilters.payerId)
	const [payeeId, setPayeeId] = useState<string | undefined>(savedFilters.payeeId)
	const [payerQuery, setPayerQuery] = useState(savedFilters.payerQuery)
	const [payeeQuery, setPayeeQuery] = useState(savedFilters.payeeQuery)
	const [dueAfter, setDueAfter] = useState(savedFilters.dueAfter)
	const [dueBefore, setDueBefore] = useState(savedFilters.dueBefore)
	useEffect(() => {
		writeBillingFilterSession('mine', {
			status,
			issuerQuery: '',
			payerType,
			payerId,
			payerQuery,
			payeeType,
			payeeId,
			payeeQuery,
			dueAfter,
			dueBefore,
		})
	}, [status, payerType, payerId, payerQuery, payeeType, payeeId, payeeQuery, dueAfter, dueBefore])
	const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
	const [sorting, setSorting] = useState<BillListSortingState>({
		sortBy: 'dueDate',
		sortDir: 'asc',
	})
	const debouncedPayerQuery = useDebounce(payerQuery, 300)
	const debouncedPayeeQuery = useDebounce(payeeQuery, 300)
	const sortBy = sorting.sortBy as BillListSortField
	const sortDir = sorting.sortDir
	const billPage = useMyBills({
		status,
		payerType,
		payeeType,
		payerId,
		payeeId,
		dueAfter: dueAfter || undefined,
		dueBefore: dueBefore || undefined,
		limit: pagination.pageSize,
		offset: pagination.pageIndex * pagination.pageSize,
		sortBy,
		sortDir,
	})
	const payerSearch = useMyBillPartySearch({
		q: debouncedPayerQuery,
		direction: 'payer',
		entityType: payerType,
		enabled: debouncedPayerQuery.trim().length >= 2,
	})
	const payeeSearch = useMyBillPartySearch({
		q: debouncedPayeeQuery,
		direction: 'payee',
		entityType: payeeType,
		enabled: debouncedPayeeQuery.trim().length >= 2,
	})
	const payerOptions = useMemo(() => {
		const deduped = new Map<string, { value: string; label: string; description: string }>()
		for (const row of payerSearch.data ?? []) {
			const key = row.entityId
			if (deduped.has(key)) continue
			deduped.set(key, {
				value: row.entityId,
				label: row.name || row.entityId,
				description: row.entityId,
			})
		}
		return [...deduped.values()]
	}, [payerSearch.data])
	const payeeOptions = useMemo(() => {
		const deduped = new Map<string, { value: string; label: string; description: string }>()
		for (const row of payeeSearch.data ?? []) {
			const key = row.entityId
			if (deduped.has(key)) continue
			deduped.set(key, {
				value: row.entityId,
				label: row.name || row.entityId,
				description: row.entityId,
			})
		}
		return [...deduped.values()]
	}, [payeeSearch.data])
	const resetFilters = () => {
		setStatus(undefined)
		setPayerType(undefined)
		setPayeeType(undefined)
		setPayerId(undefined)
		setPayeeId(undefined)
		setPayerQuery('')
		setPayeeQuery('')
		setDueAfter(getDefaultBillDueAfter())
		setDueBefore('')
		setPagination((prev) => ({ ...prev, pageIndex: 0 }))
	}
	const rows = billPage.data?.rows ?? []
	const getBillHref = (bill: BillWithDetails) =>
		bill.groupBillTotalCount != null && bill.groupBillId
			? `/my-bills/group/${encodeURIComponent(bill.groupBillId)}`
			: `/my-bills/${bill.id}`

	return (
		<Container className={cn(isTableGridClamped && 'lg:flex lg:h-full lg:min-h-0 lg:flex-col')}>
			<PageHeader
				title="Bills"
				description="View bills assigned to you or your corporations"
				action={
					canIssueBills ? (
						<Button variant="primary" asChild>
							<Link to="/bills/issue">
								<Plus className="h-4 w-4" />
								Create Bill
							</Link>
						</Button>
					) : undefined
				}
			/>
			<div
				className={cn(
					'space-y-6',
					isTableGridClamped && 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col'
				)}
			>
				<BillListFilters
					status={status}
					payerType={payerType}
					payeeType={payeeType}
					payerId={payerId}
					payerQuery={payerQuery}
					setPayerQuery={setPayerQuery}
					payeeId={payeeId}
					payeeQuery={payeeQuery}
					setPayeeQuery={setPayeeQuery}
					dueAfter={dueAfter}
					dueBefore={dueBefore}
					payerOptions={payerOptions}
					payeeOptions={payeeOptions}
					payerLoading={payerSearch.isLoading}
					payeeLoading={payeeSearch.isLoading}
					onStatusChange={(value) => {
						setStatus(value)
						setPagination((prev) => ({ ...prev, pageIndex: 0 }))
					}}
					onPayerTypeChange={(value) => {
						setPayerType(value)
						setPayerId(undefined)
						setPayerQuery('')
						setPagination((prev) => ({ ...prev, pageIndex: 0 }))
					}}
					onPayeeTypeChange={(value) => {
						setPayeeType(value)
						setPayeeId(undefined)
						setPayeeQuery('')
						setPagination((prev) => ({ ...prev, pageIndex: 0 }))
					}}
					onPayerIdChange={(value) => {
						setPayerId(value)
						setPagination((prev) => ({ ...prev, pageIndex: 0 }))
					}}
					onPayeeIdChange={(value) => {
						setPayeeId(value)
						setPagination((prev) => ({ ...prev, pageIndex: 0 }))
					}}
					onDateRangeChange={(fromDate, toDate) => {
						setDueAfter(fromDate)
						setDueBefore(toDate)
						setPagination((prev) => ({ ...prev, pageIndex: 0 }))
					}}
					onReset={resetFilters}
				/>
				<BillListGrid
					clamped={isTableGridClamped}
					rows={rows}
					loading={billPage.isLoading}
					error={billPage.error}
					sorting={sorting}
					onSortingChange={(nextSorting) => {
						setSorting(nextSorting)
						setPagination((prev) => ({ ...prev, pageIndex: 0 }))
					}}
					pagination={pagination}
					onPaginationChange={setPagination}
					rowCount={billPage.data?.rowCount ?? 0}
					rowInteraction={{ type: 'link', getHref: getBillHref }}
					paginationLeadingAction={
						<TableLayoutToggle
							isClamped={isTableGridClamped}
							onToggle={() => setIsPageScrollEnabled(!isPageScrollEnabled)}
						/>
					}
					renderActions={(bill) => <OwnedBillActions bill={bill} />}
					emptyMessage="No bills found for the current filters."
				/>
			</div>
		</Container>
	)
}

function OwnedBillActions({ bill }: { bill: BillWithDetails }) {
	const { user } = useAuth()
	const { permissions, isAdmin } = useUserPermissions()
	const canIssueGroupBills =
		isAdmin ||
		getBillingIssuerScopeFromUrns(permissions.map((permission) => permission.urn)).unrestricted
	const issueBill = useIssueIssuedBill()
	const markIssuedBillPaid = useMarkIssuedBillPaid()
	const cancelBill = useCancelIssuedBill()
	const revertBill = useRevertIssuedBillToDraft()
	const deleteBill = useDeleteIssuedBill()
	const canIssueBills = hasBillingIssuerPermission(permissions, isAdmin)
	const isOwnedManualBill = canIssueBills && user?.id === bill.issuerId && isManualBill(bill)
	const issueGroupBill = useIssueGroupBill('issuer')
	const cancelGroupBill = useCancelGroupBill('issuer')
	const deleteGroupBill = useDeleteGroupBill('issuer')
	const revertGroupBill = useRevertGroupBillToDraft('issuer')

	const action = async (operation: () => Promise<unknown>) => {
		try {
			await operation()
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to update bill')
		}
	}

	const actionItems: BillActionItem[] = [
		{ label: 'View', intent: 'primary', href: getOwnedBillHref(bill) },
	]
	if (
		canIssueGroupBills &&
		user?.id === bill.issuerId &&
		bill.groupBillTotalCount != null &&
		bill.groupBillId
	) {
		const groupBillId = bill.groupBillId
		actionItems.push(
			{
				label: 'Edit',
				intent: 'secondary',
				href: `/my-bills/group/${encodeURIComponent(groupBillId)}/edit`,
				hidden: (bill.groupBillEditableCount ?? 0) === 0,
			},
			{
				label: 'Issue',
				intent: 'confirm',
				hidden: (bill.groupBillDraftCount ?? 0) === 0,
				loading: issueGroupBill.isPending,
				onClick: () => void action(() => issueGroupBill.mutateAsync(groupBillId)),
			},
			{
				label: 'To Draft',
				intent: 'secondary',
				hidden: (bill.groupBillRevertibleCount ?? 0) === 0,
				loading: revertGroupBill.isPending,
				onClick: () => void action(() => revertGroupBill.mutateAsync(groupBillId)),
			},
			{
				label: 'Cancel',
				intent: 'muted',
				hidden: (bill.groupBillCancellableCount ?? 0) === 0,
				loading: cancelGroupBill.isPending,
				onClick: () => void action(() => cancelGroupBill.mutateAsync(groupBillId)),
			},
			{
				label: 'Delete',
				intent: 'destructive',
				hidden: (bill.groupBillDraftCount ?? 0) === 0,
				loading: deleteGroupBill.isPending,
				onClick: () => void action(() => deleteGroupBill.mutateAsync(groupBillId)),
			}
		)
		return <BillActionsMenu items={actionItems} />
	}
	if (
		canIssueBills &&
		bill.canMarkPaid &&
		bill.status !== 'draft' &&
		bill.status !== 'paid' &&
		bill.status !== 'cancelled'
	) {
		actionItems.push({
			label: 'Mark Paid',
			intent: 'confirm',
			loading: markIssuedBillPaid.isPending,
			onClick: () => void action(() => markIssuedBillPaid.mutateAsync(bill.id)),
		})
	}
	if (isOwnedManualBill && bill.status === 'draft') {
		actionItems.push(
			{
				label: 'Issue',
				intent: 'confirm',
				loading: issueBill.isPending,
				onClick: () => void action(() => issueBill.mutateAsync(bill.id)),
			},
			{
				label: 'Delete',
				intent: 'destructive',
				loading: deleteBill.isPending,
				onClick: () => void action(() => deleteBill.mutateAsync(bill.id)),
			}
		)
	}
	if (isOwnedManualBill && bill.canRevertToDraft === true) {
		actionItems.push({
			label: 'To Draft',
			intent: 'secondary',
			loading: revertBill.isPending,
			onClick: () => void action(() => revertBill.mutateAsync(bill.id)),
		})
		if (bill.status !== 'cancelled') {
			actionItems.push({
				label: 'Cancel',
				intent: 'muted',
				loading: cancelBill.isPending,
				onClick: () => void action(() => cancelBill.mutateAsync(bill.id)),
			})
		}
	}

	return (
		<div className="flex items-center justify-end gap-2">
			<BillActionsMenu items={actionItems} />
		</div>
	)
}

function getOwnedBillHref(bill: BillWithDetails): string {
	return bill.groupBillTotalCount != null && bill.groupBillId
		? `/my-bills/group/${encodeURIComponent(bill.groupBillId)}`
		: `/my-bills/${bill.id}`
}
