import { useQueryClient } from '@tanstack/react-query'
import { Calendar, FileText, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { BillActionsMenu } from '@/components/bills/bill-actions-menu'
import {
	getDefaultBillDueAfter,
	readBillingFilterSession,
	writeBillingFilterSession,
} from '@/components/bills/bill-filter-session'
import { BillListFilters } from '@/components/bills/bill-list-filters'
import { BillListGrid } from '@/components/bills/bill-list-grid'
import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { ISKAmount } from '@/components/bills/isk-amount'
import { useLayoutScrollMode } from '@/components/layout-scroll-context'
import { TableLayoutToggle } from '@/components/table-layout-toggle'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import {
	stickyTableActionCellClassName,
	stickyTableActionHeaderClassName,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	groupBillKeys,
	useBillEntitySearch,
	useBillPartySearch,
	useBills,
	useCancelBill,
	useCancelGroupBill,
	useDeleteBill,
	useDeleteGroupBill,
	useGroupBillAggregate,
	useIssueBill,
	useIssueGroupBill,
	useMarkBillPaid,
	useRevertBillToDraft,
	useRevertGroupBillToDraft,
} from '@/hooks/useBills'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'
import toast from '@/lib/toast'
import { cn } from '@/lib/utils'

import type {
	BillListSortDirection,
	BillListSortField,
	BillStatus,
	BillWithDetails,
	EntityType,
} from '@repo/bills'
import type { BillListSortingState } from '@/components/bills/bill-list-types'

export default function AdminBillsPage() {
	usePageTitle('Admin - Bills Management')
	const { isPageScrollEnabled, setIsPageScrollEnabled } = useLayoutScrollMode()
	const isTableGridClamped = !isPageScrollEnabled
	const [savedFilters] = useState(() =>
		readBillingFilterSession('admin', {
			issuerQuery: '',
			payerQuery: '',
			payeeQuery: '',
			dueAfter: getDefaultBillDueAfter(),
			dueBefore: '',
			coalesced: true,
		})
	)
	const [status, setStatus] = useState<BillStatus | undefined>(savedFilters.status)
	const [issuerId, setIssuerId] = useState<string | undefined>(savedFilters.issuerId)
	const [issuerQuery, setIssuerQuery] = useState(savedFilters.issuerQuery)
	const [payerType, setPayerType] = useState<EntityType | undefined>(savedFilters.payerType)
	const [payeeType, setPayeeType] = useState<EntityType | undefined>(savedFilters.payeeType)
	const [payerId, setPayerId] = useState<string | undefined>(savedFilters.payerId)
	const [payeeId, setPayeeId] = useState<string | undefined>(savedFilters.payeeId)
	const [payerQuery, setPayerQuery] = useState(savedFilters.payerQuery)
	const [payeeQuery, setPayeeQuery] = useState(savedFilters.payeeQuery)
	const [dueAfter, setDueAfter] = useState(savedFilters.dueAfter)
	const [dueBefore, setDueBefore] = useState(savedFilters.dueBefore)
	const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
	const [sorting, setSorting] = useState<BillListSortingState>({
		sortBy: 'createdAt',
		sortDir: 'desc',
	})
	const [coalesced, setCoalesced] = useState(savedFilters.coalesced ?? true)
	useEffect(() => {
		writeBillingFilterSession('admin', {
			status,
			issuerId,
			issuerQuery,
			payerType,
			payerId,
			payerQuery,
			payeeType,
			payeeId,
			payeeQuery,
			dueAfter,
			dueBefore,
			coalesced,
		})
	}, [
		status,
		issuerId,
		issuerQuery,
		payerType,
		payerId,
		payerQuery,
		payeeType,
		payeeId,
		payeeQuery,
		dueAfter,
		dueBefore,
		coalesced,
	])
	const debouncedPayerQuery = useDebounce(payerQuery, 300)
	const debouncedPayeeQuery = useDebounce(payeeQuery, 300)
	const debouncedIssuerQuery = useDebounce(issuerQuery, 300)
	const sortBy = sorting.sortBy as BillListSortField
	const sortDir: BillListSortDirection = sorting.sortDir
	const billsPage = useBills({
		status,
		issuerId,
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
		coalesced,
	})
	const payerSearch = useBillPartySearch({
		q: debouncedPayerQuery,
		direction: 'payer',
		entityType: payerType,
		enabled: debouncedPayerQuery.trim().length >= 2,
	})
	const payeeSearch = useBillPartySearch({
		q: debouncedPayeeQuery,
		direction: 'payee',
		entityType: payeeType,
		enabled: debouncedPayeeQuery.trim().length >= 2,
	})
	const issuerSearch = useBillEntitySearch({
		q: debouncedIssuerQuery,
		entityType: 'user',
		enabled: debouncedIssuerQuery.trim().length >= 2,
	})
	const issuerOptions = useMemo(() => {
		const deduped = new Map<string, { value: string; label: string; description: string }>()
		for (const row of issuerSearch.data ?? []) {
			const key = row.entityId
			if (deduped.has(key)) continue
			deduped.set(key, {
				value: row.entityId,
				label: row.name || row.entityId,
				description: row.entityId,
			})
		}
		return [...deduped.values()]
	}, [issuerSearch.data])
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
	const issueBill = useIssueBill()
	const cancelBill = useCancelBill()
	const markBillPaid = useMarkBillPaid()
	const deleteBill = useDeleteBill()
	const revertBillToDraft = useRevertBillToDraft()
	const issueGroupBill = useIssueGroupBill()
	const cancelGroupBill = useCancelGroupBill()
	const deleteGroupBill = useDeleteGroupBill()
	const revertGroupBillToDraft = useRevertGroupBillToDraft()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const toGroupViewHref = (groupBillId: string) =>
		`/admin/bills/group/${encodeURIComponent(groupBillId)}`
	const getBillHref = (bill: BillWithDetails) =>
		bill.groupBillTotalCount != null && bill.groupBillId
			? toGroupViewHref(bill.groupBillId)
			: `/admin/bills/${bill.id}`

	// Individual bill action handlers
	const handleIssue = async (billId: string) => {
		try {
			await issueBill.mutateAsync(billId)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to issue bill')
		}
	}

	const handleCancel = async (billId: string) => {
		requestConfirmation({
			title: 'Cancel Bill',
			description: 'Are you sure you want to cancel this bill?',
			confirmLabel: 'Cancel Bill',
			intent: 'confirm',
			onConfirm: async () => {
				try {
					await cancelBill.mutateAsync(billId)
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Failed to cancel bill')
				}
			},
		})
	}

	const handleDelete = async (billId: string) => {
		requestConfirmation({
			title: 'Delete Bill',
			description: 'Are you sure you want to delete this bill? This action cannot be undone.',
			confirmLabel: 'Delete Bill',
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteBill.mutateAsync(billId)
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Failed to delete bill')
				}
			},
		})
	}

	const handleMarkPaid = async (billId: string) => {
		requestConfirmation({
			title: 'Mark Bill Paid',
			description: 'Mark this bill as paid?',
			confirmLabel: 'Mark Paid',
			intent: 'confirm',
			onConfirm: async () => {
				try {
					await markBillPaid.mutateAsync(billId)
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Failed to mark bill paid')
				}
			},
		})
	}

	const handleRevertToDraft = async (billId: string) => {
		requestConfirmation({
			title: 'Move Bill To Draft',
			description: 'Move this bill back to draft?',
			confirmLabel: 'To Draft',
			intent: 'secondary',
			onConfirm: async () => {
				try {
					await revertBillToDraft.mutateAsync(billId)
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Failed to revert bill to draft')
				}
			},
		})
	}

	// Group bill bulk action handlers
	const handleGroupIssue = async (groupBillId: string) => {
		try {
			await issueGroupBill.mutateAsync(groupBillId)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to issue group bill')
		}
	}

	const handleGroupCancel = async (groupBillId: string) => {
		requestConfirmation({
			title: 'Cancel Group Bill',
			description: 'Cancel all eligible bills in this group?',
			confirmLabel: 'Cancel All',
			intent: 'confirm',
			onConfirm: async () => {
				try {
					await cancelGroupBill.mutateAsync(groupBillId)
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Failed to cancel group bill')
				}
			},
		})
	}

	const handleGroupDelete = async (groupBillId: string) => {
		requestConfirmation({
			title: 'Delete Group Bill',
			description: 'Delete all draft bills in this group? This cannot be undone.',
			confirmLabel: 'Delete All',
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteGroupBill.mutateAsync(groupBillId)
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Failed to delete group bill')
				}
			},
		})
	}

	const handleGroupRevertToDraft = async (groupBillId: string) => {
		requestConfirmation({
			title: 'Revert Group Bill to Draft',
			description: 'Move all eligible bills in this group back to draft?',
			confirmLabel: 'To Draft',
			intent: 'secondary',
			onConfirm: async () => {
				try {
					await revertGroupBillToDraft.mutateAsync(groupBillId)
				} catch (error) {
					toast.error(
						error instanceof Error ? error.message : 'Failed to revert group bill to draft'
					)
				}
			},
		})
	}

	const resetFilters = () => {
		setStatus(undefined)
		setIssuerId(undefined)
		setIssuerQuery('')
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
	const rows = billsPage.data?.rows ?? []
	const hasGroupBills = coalesced
		? rows.some((r) => r.groupBillTotalCount != null)
		: rows.some((r) => r.groupBillId != null)

	// Renders the expanded sub-bills panel for a coalesced group row
	const renderExpandedGroupBill = (bill: BillWithDetails) => {
		if (!bill.groupBillId) return null
		return <GroupBillSubRows groupBillId={bill.groupBillId} />
	}

	return (
		<div
			className={cn('space-y-6', isTableGridClamped && 'lg:flex lg:h-full lg:min-h-0 lg:flex-col')}
		>
			<PageHeader
				title="Bills Management"
				description="View and manage all bills"
				action={
					<div className="flex gap-2">
						<Button variant="ghost" asChild>
							<Link to="/admin/bills/templates">
								<FileText className="h-4 w-4" />
								Templates
							</Link>
						</Button>
						<Button variant="ghost" asChild>
							<Link to="/admin/bills/schedules">
								<Calendar className="h-4 w-4" />
								Schedules
							</Link>
						</Button>
						<Button variant="primary" asChild>
							<Link to="/admin/bills/new">
								<Plus className="h-4 w-4" />
								Create Bill
							</Link>
						</Button>
					</div>
				}
			/>
			<BillListFilters
				status={status}
				issuerId={issuerId}
				issuerQuery={issuerQuery}
				setIssuerQuery={setIssuerQuery}
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
				issuerOptions={issuerOptions}
				payerOptions={payerOptions}
				payeeOptions={payeeOptions}
				issuerLoading={issuerSearch.isLoading}
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
				onIssuerIdChange={(value) => {
					setIssuerId(value)
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
				coalesced={coalesced}
				hasGroupBills={hasGroupBills}
				onCoalescedToggle={() => {
					setCoalesced((prev) => !prev)
					setPagination((prev) => ({ ...prev, pageIndex: 0 }))
				}}
			/>
			<BillListGrid
				clamped={isTableGridClamped}
				rows={rows}
				loading={billsPage.isLoading}
				error={billsPage.error}
				sorting={sorting}
				onSortingChange={(nextSorting) => {
					setSorting(nextSorting)
					setPagination((prev) => ({ ...prev, pageIndex: 0 }))
				}}
				pagination={pagination}
				onPaginationChange={setPagination}
				rowCount={billsPage.data?.rowCount ?? 0}
				rowInteraction={{ type: 'link', getHref: getBillHref }}
				paginationLeadingAction={
					<TableLayoutToggle
						isClamped={isTableGridClamped}
						onToggle={() => setIsPageScrollEnabled(!isPageScrollEnabled)}
					/>
				}
				renderActions={(bill) => {
					// Coalesced group aggregate row — show bulk actions menu
					if (bill.groupBillTotalCount != null && bill.groupBillId) {
						const groupBillId = bill.groupBillId
						return (
							<BillActionsMenu
								items={[
									{
										label: 'View',
										intent: 'primary',
										href: toGroupViewHref(groupBillId),
									},
									{
										label: 'Edit',
										intent: 'secondary',
										hidden: (bill.groupBillEditableCount ?? 0) === 0,
										href: `/admin/bills/group/${groupBillId}/edit`,
									},
									{
										label: 'To Draft',
										intent: 'secondary',
										hidden: (bill.groupBillRevertibleCount ?? 0) === 0,
										loading: revertGroupBillToDraft.isPending,
										onClick: () => void handleGroupRevertToDraft(groupBillId),
									},
									{
										label: 'Issue All',
										intent: 'confirm',
										hidden: (bill.groupBillDraftCount ?? 0) === 0,
										loading: issueGroupBill.isPending,
										onClick: () => void handleGroupIssue(groupBillId),
									},
									{
										label: 'Cancel All',
										intent: 'muted',
										hidden: (bill.groupBillCancellableCount ?? 0) === 0,
										loading: cancelGroupBill.isPending,
										onClick: () => void handleGroupCancel(groupBillId),
									},
									{
										label: 'Delete All',
										intent: 'destructive',
										hidden: (bill.groupBillDraftCount ?? 0) === 0,
										loading: deleteGroupBill.isPending,
										onClick: () => void handleGroupDelete(groupBillId),
									},
								]}
							/>
						)
					}

					// Individual bill row
					return (
						<BillActionsMenu
							items={[
								{
									label: 'View',
									intent: 'primary',
									href: `/admin/bills/${bill.id}`,
								},
								{
									label: 'Edit',
									intent: 'secondary',
									hidden: bill.status !== 'draft',
									href: `/admin/bills/${bill.id}/edit`,
								},
								{
									label: 'To Draft',
									intent: 'secondary',
									hidden: bill.status === 'draft' || bill.status === 'paid',
									loading: revertBillToDraft.isPending,
									onClick: () => void handleRevertToDraft(bill.id),
								},
								{
									label: 'Issue',
									intent: 'confirm',
									hidden: bill.status !== 'draft',
									loading: issueBill.isPending,
									onClick: () => void handleIssue(bill.id),
								},
								{
									label: 'Cancel',
									intent: 'muted',
									hidden: bill.status === 'paid' || bill.status === 'cancelled',
									loading: cancelBill.isPending,
									onClick: () => void handleCancel(bill.id),
								},
								{
									label: 'Mark Paid',
									intent: 'confirm',
									hidden:
										bill.status === 'draft' ||
										bill.status === 'paid' ||
										bill.status === 'cancelled',
									loading: markBillPaid.isPending,
									onClick: () => void handleMarkPaid(bill.id),
								},
								{
									label: 'Delete',
									intent: 'destructive',
									hidden: bill.status !== 'draft',
									loading: deleteBill.isPending,
									onClick: () => void handleDelete(bill.id),
								},
							]}
						/>
					)
				}}
				renderExpandedGroupBill={coalesced ? renderExpandedGroupBill : undefined}
				emptyMessage="No bills found for the current filters."
			/>
			{confirmationDialog}
		</div>
	)
}

// Inline sub-bills panel rendered when a coalesced group row is expanded
function GroupBillSubRows(props: { groupBillId: string }) {
	const { data: aggregate, isLoading } = useGroupBillAggregate(props.groupBillId)
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const issueBill = useIssueBill()
	const cancelBill = useCancelBill()
	const markBillPaid = useMarkBillPaid()
	const deleteBill = useDeleteBill()
	const revertBillToDraft = useRevertBillToDraft()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const runSubBillAction = async (operation: () => Promise<unknown>, fallback: string) => {
		try {
			await operation()
			await queryClient.invalidateQueries({ queryKey: groupBillKeys.aggregate(props.groupBillId) })
		} catch (error) {
			toast.error(error instanceof Error ? error.message : fallback)
		}
	}

	if (isLoading) {
		return <div className="px-4 py-3 text-sm text-muted-foreground">Loading sub-bills...</div>
	}

	if (!aggregate) {
		return <div className="px-4 py-3 text-sm text-destructive">Failed to load sub-bills.</div>
	}

	return (
		<div
			className="w-full min-w-0 max-w-[calc(100vw-2rem)] border-l-2 border-muted px-4 py-3 space-y-2 md:max-w-[calc(100vw-3rem)] lg:max-w-[min(120rem,calc(100vw-20rem))]"
			style={{ contain: 'inline-size' }}
		>
			{confirmationDialog}
			<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Sub-bills ({aggregate.bills.length})
			</p>
			<Table
				className="w-full text-sm"
				containerClassName="w-full min-w-0 max-w-full overflow-hidden pr-6"
			>
				<TableHeader>
					<TableRow className="bg-transparent">
						<TableHead className="px-4 text-xs whitespace-nowrap">Status</TableHead>
						<TableHead className="px-4 text-xs whitespace-nowrap">Payer</TableHead>
						<TableHead className="px-4 text-xs whitespace-nowrap">Amount</TableHead>
						<TableHead
							className={`${stickyTableActionHeaderClassName} px-4 text-right text-xs whitespace-nowrap`}
						>
							Actions
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{aggregate.bills.map((subBill) => (
						<TableRow
							key={subBill.billId}
							className="cursor-pointer"
							onClick={(event) => {
								const target = event.target as HTMLElement | null
								if (target?.closest('a, button, [role="button"]')) return
								const href = `/admin/bills/${subBill.billId}`
								if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
									event.preventDefault()
									window.open(href, '_blank', 'noopener,noreferrer')
									return
								}
								void navigate(href)
							}}
							onAuxClick={(event) => {
								if (event.button !== 1) return
								const target = event.target as HTMLElement | null
								if (target?.closest('a, button, [role="button"]')) return
								event.preventDefault()
								window.open(`/admin/bills/${subBill.billId}`, '_blank', 'noopener,noreferrer')
							}}
						>
							<TableCell className="px-4">
								<Link
									to={`/admin/bills/${subBill.billId}`}
									className="block no-underline hover:no-underline"
								>
									<BillStatusBadge status={subBill.status} />
								</Link>
							</TableCell>
							<TableCell className="px-4">
								<Link
									to={`/admin/bills/${subBill.billId}`}
									className="block break-words text-foreground no-underline hover:no-underline"
								>
									{subBill.payerName ?? subBill.payerId}
								</Link>
							</TableCell>
							<TableCell className="px-4 whitespace-nowrap">
								<Link
									to={`/admin/bills/${subBill.billId}`}
									className="block no-underline hover:no-underline"
								>
									<ISKAmount amount={subBill.amount} />
								</Link>
							</TableCell>
							<TableCell className={`${stickyTableActionCellClassName} px-4 text-right`}>
								<BillActionsMenu
									items={[
										{
											label: 'View',
											intent: 'primary',
											href: `/admin/bills/${subBill.billId}`,
										},
										{
											label: 'Edit',
											intent: 'secondary',
											hidden: subBill.status !== 'draft',
											href: `/admin/bills/${subBill.billId}/edit`,
										},
										{
											label: 'To Draft',
											intent: 'secondary',
											hidden: subBill.status === 'draft' || subBill.status === 'paid',
											loading: revertBillToDraft.isPending,
											onClick: () => {
												requestConfirmation({
													title: 'Move Bill To Draft',
													description: 'Move this bill back to draft?',
													confirmLabel: 'To Draft',
													intent: 'secondary',
													onConfirm: async () => {
														await runSubBillAction(
															() => revertBillToDraft.mutateAsync(subBill.billId),
															'Failed to revert bill to draft'
														)
													},
												})
											},
										},
										{
											label: 'Issue',
											intent: 'confirm',
											hidden: subBill.status !== 'draft',
											loading: issueBill.isPending,
											onClick: () => {
												requestConfirmation({
													title: 'Issue Bill',
													description: 'Issue this bill?',
													confirmLabel: 'Issue',
													intent: 'confirm',
													onConfirm: async () => {
														await runSubBillAction(
															() => issueBill.mutateAsync(subBill.billId),
															'Failed to issue bill'
														)
													},
												})
											},
										},
										{
											label: 'Cancel',
											intent: 'muted',
											hidden: subBill.status === 'paid' || subBill.status === 'cancelled',
											loading: cancelBill.isPending,
											onClick: () => {
												requestConfirmation({
													title: 'Cancel Bill',
													description: 'Cancel this bill?',
													confirmLabel: 'Cancel',
													intent: 'confirm',
													onConfirm: async () => {
														await runSubBillAction(
															() => cancelBill.mutateAsync(subBill.billId),
															'Failed to cancel bill'
														)
													},
												})
											},
										},
										{
											label: 'Mark Paid',
											intent: 'confirm',
											hidden:
												subBill.status === 'draft' ||
												subBill.status === 'paid' ||
												subBill.status === 'cancelled',
											loading: markBillPaid.isPending,
											onClick: () => {
												requestConfirmation({
													title: 'Mark Bill Paid',
													description: 'Mark this bill as paid?',
													confirmLabel: 'Mark Paid',
													intent: 'confirm',
													onConfirm: async () => {
														await runSubBillAction(
															() => markBillPaid.mutateAsync(subBill.billId),
															'Failed to mark bill paid'
														)
													},
												})
											},
										},
										{
											label: 'Delete',
											intent: 'destructive',
											hidden: subBill.status !== 'draft',
											loading: deleteBill.isPending,
											onClick: () => {
												requestConfirmation({
													title: 'Delete Bill',
													description: 'Delete this bill? This cannot be undone.',
													confirmLabel: 'Delete',
													intent: 'destructive',
													onConfirm: async () => {
														await runSubBillAction(
															() => deleteBill.mutateAsync(subBill.billId),
															'Failed to delete bill'
														)
													},
												})
											},
										},
									]}
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	)
}
