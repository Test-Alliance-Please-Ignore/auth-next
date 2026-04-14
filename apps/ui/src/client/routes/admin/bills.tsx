import { Calendar, ChevronDown, Edit, FileText, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'

import { BillListFilters } from '@/components/bills/bill-list-filters'
import { BillListGrid } from '@/components/bills/bill-list-grid'
import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { ISKAmount } from '@/components/bills/isk-amount'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
	useRevertBillToDraft,
	useRevertGroupBillToDraft,
} from '@/hooks/useBills'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { MRT_Row, MRT_SortingState } from 'mantine-react-table'
import type {
	BillListSortDirection,
	BillListSortField,
	BillStatus,
	BillWithDetails,
	EntityType,
} from '@repo/bills'

function toDateInputValue(date: Date): string {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

function getDefaultDueAfter(): string {
	const date = new Date()
	date.setDate(date.getDate() - 30)
	return toDateInputValue(date)
}

export default function AdminBillsPage() {
	usePageTitle('Admin - Bills Management')
	const [status, setStatus] = useState<BillStatus | undefined>(undefined)
	const [issuerId, setIssuerId] = useState<string | undefined>(undefined)
	const [issuerQuery, setIssuerQuery] = useState('')
	const [payerType, setPayerType] = useState<EntityType | undefined>(undefined)
	const [payeeType, setPayeeType] = useState<EntityType | undefined>(undefined)
	const [payerId, setPayerId] = useState<string | undefined>(undefined)
	const [payeeId, setPayeeId] = useState<string | undefined>(undefined)
	const [payerQuery, setPayerQuery] = useState('')
	const [payeeQuery, setPayeeQuery] = useState('')
	const [dueAfter, setDueAfter] = useState(() => getDefaultDueAfter())
	const [dueBefore, setDueBefore] = useState('')
	const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
	const [sorting, setSorting] = useState<MRT_SortingState>([{ id: 'dueDate', desc: false }])
	const [coalesced, setCoalesced] = useState(true)
	const debouncedPayerQuery = useDebounce(payerQuery, 300)
	const debouncedPayeeQuery = useDebounce(payeeQuery, 300)
	const debouncedIssuerQuery = useDebounce(issuerQuery, 300)
	const sortBy = (sorting[0]?.id ?? 'dueDate') as BillListSortField
	const sortDir: BillListSortDirection = sorting[0]?.desc ? 'desc' : 'asc'
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
	const pageCount = Math.max(
		1,
		Math.ceil((billsPage.data?.rowCount ?? 0) / Math.max(1, pagination.pageSize))
	)
	const issueBill = useIssueBill()
	const cancelBill = useCancelBill()
	const deleteBill = useDeleteBill()
	const revertBillToDraft = useRevertBillToDraft()
	const issueGroupBill = useIssueGroupBill()
	const cancelGroupBill = useCancelGroupBill()
	const deleteGroupBill = useDeleteGroupBill()
	const revertGroupBillToDraft = useRevertGroupBillToDraft()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	// Individual bill action handlers
	const handleIssue = async (billId: string) => {
		try {
			await issueBill.mutateAsync(billId)
		} catch (error) {
			console.error('Failed to issue bill:', error)
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
					console.error('Failed to cancel bill:', error)
					throw error
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
					console.error('Failed to delete bill:', error)
					throw error
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
					console.error('Failed to revert bill to draft:', error)
					throw error
				}
			},
		})
	}

	// Group bill bulk action handlers
	const handleGroupIssue = async (groupBillId: string) => {
		try {
			await issueGroupBill.mutateAsync(groupBillId)
		} catch (error) {
			console.error('Failed to issue group bill:', error)
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
					console.error('Failed to cancel group bill:', error)
					throw error
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
					console.error('Failed to delete group bill:', error)
					throw error
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
					console.error('Failed to revert group bill to draft:', error)
					throw error
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
		setDueAfter(getDefaultDueAfter())
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
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Bills Management</h1>
					<p className="text-muted-foreground mt-1">View and manage all bills</p>
				</div>
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
			</div>
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
				pageCount={pageCount}
				rowCount={billsPage.data?.rowCount ?? 0}
				renderActions={(bill, row) => {
					// Coalesced group aggregate row — show bulk actions menu
					if (bill.groupBillTotalCount != null && bill.groupBillId) {
						const groupBillId = bill.groupBillId
						return (
							<ActionsMenu
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
										href: `/admin/bills/group/${groupBillId}/edit`,
									},
									{
										label: 'To Draft',
										intent: 'secondary',
										hidden: bill.status === 'draft' || bill.status === 'paid',
										loading: revertGroupBillToDraft.isPending,
										onClick: () => void handleGroupRevertToDraft(groupBillId),
									},
									{
										label: 'Issue All',
										intent: 'confirm',
										hidden: bill.status !== 'draft',
										loading: issueGroupBill.isPending,
										onClick: () => void handleGroupIssue(groupBillId),
									},
									{
										label: 'Cancel All',
										intent: 'muted',
										hidden: bill.status === 'paid' || bill.status === 'cancelled',
										loading: cancelGroupBill.isPending,
										onClick: () => void handleGroupCancel(groupBillId),
									},
									{
										label: 'Delete All',
										intent: 'destructive',
										hidden: bill.status !== 'draft',
										loading: deleteGroupBill.isPending,
										onClick: () => void handleGroupDelete(groupBillId),
									},
								]}
							/>
						)
					}

					// Individual bill row
					return (
						<ActionsMenu
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
	const queryClient = useQueryClient()
	const issueBill = useIssueBill()
	const cancelBill = useCancelBill()
	const deleteBill = useDeleteBill()
	const revertBillToDraft = useRevertBillToDraft()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const invalidateAggregate = () =>
		queryClient.invalidateQueries({ queryKey: groupBillKeys.aggregate(props.groupBillId) })

	if (isLoading) {
		return <div className="px-4 py-3 text-sm text-muted-foreground">Loading sub-bills...</div>
	}

	if (!aggregate) {
		return <div className="px-4 py-3 text-sm text-destructive">Failed to load sub-bills.</div>
	}

	return (
		<div className="px-4 py-3 space-y-2">
			{confirmationDialog}
			<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Sub-bills ({aggregate.bills.length})
			</p>
			<table className="text-sm">
				<thead>
					<tr className="text-left text-xs text-muted-foreground border-b border-border">
						<th className="pb-1 pr-4 font-medium whitespace-nowrap">Status</th>
						<th className="pb-1 pr-4 font-medium whitespace-nowrap">Payer</th>
						<th className="pb-1 pr-4 font-medium whitespace-nowrap">Amount</th>
						<th className="pb-1 font-medium whitespace-nowrap text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{aggregate.bills.map((subBill) => (
						<tr key={subBill.billId} className="border-b border-border/50 last:border-0">
							<td className="py-1.5 pr-4">
								<BillStatusBadge status={subBill.status} />
							</td>
							<td className="py-1.5 pr-4 whitespace-nowrap">
								<span className="text-foreground">{subBill.payerName ?? subBill.payerId}</span>
							</td>
							<td className="py-1.5 pr-4 whitespace-nowrap">
								<ISKAmount amount={subBill.amount} />
							</td>
							<td className="py-1.5 text-right">
								<ActionsMenu
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
														await revertBillToDraft.mutateAsync(subBill.billId)
														invalidateAggregate()
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
														await issueBill.mutateAsync(subBill.billId)
														invalidateAggregate()
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
														await cancelBill.mutateAsync(subBill.billId)
														invalidateAggregate()
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
														await deleteBill.mutateAsync(subBill.billId)
														invalidateAggregate()
													},
												})
											},
										},
									]}
								/>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

type ActionIntent = 'confirm' | 'secondary' | 'muted' | 'destructive' | 'primary'

interface ActionItem {
	label: string
	intent: ActionIntent
	hidden?: boolean
	loading?: boolean
	onClick?: () => void
	href?: string
}

const intentBg: Record<ActionIntent, string> = {
	confirm: 'bg-[hsl(var(--confirm))]/45 hover:bg-[hsl(var(--confirm))]/65',
	destructive: 'bg-[hsl(var(--destructive-alt))]/45 hover:bg-[hsl(var(--destructive-alt))]/65',
	// neutral white tint so it's always visibly distinct from the popover backdrop
	muted: 'bg-white/15 hover:bg-[hsl(var(--cancel-hover))]/65',
	secondary: 'bg-[hsl(var(--secondary))]/45 hover:bg-[hsl(var(--secondary))]/65',
	primary: 'bg-[hsl(var(--primary))]/45 hover:bg-[hsl(var(--primary))]/65',
}

function ActionsMenu(props: { items: ActionItem[] }) {
	const [open, setOpen] = useState(false)
	const navigate = useNavigate()
	const visible = props.items.filter((item) => !item.hidden)

	if (visible.length === 0) return null

	// All items render as <button> so font-size is identical across every row.
	// (<a> and <button> compute inherited font-size differently in some browsers.)
	const baseClass =
		'w-full cursor-pointer px-3 py-2 text-left text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 first:rounded-t last:rounded-b'

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm">
					Actions <ChevronDown className="ml-1 h-3 w-3" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-44 p-1">
				{visible.map((item) => (
					<button
						key={item.label}
						type="button"
						disabled={item.loading}
						className={cn(baseClass, intentBg[item.intent])}
						onClick={() => {
							setOpen(false)
							if (item.href) {
								void navigate(item.href)
							} else {
								item.onClick?.()
							}
						}}
					>
						{item.loading ? 'Loading...' : item.label}
					</button>
				))}
			</PopoverContent>
		</Popover>
	)
}
