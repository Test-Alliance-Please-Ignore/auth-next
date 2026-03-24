import { Calendar, FileText, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { BillListFilters } from '@/components/bills/bill-list-filters'
import { BillListGrid } from '@/components/bills/bill-list-grid'
import { CancelButton } from '@/components/ui/cancel-button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { DestructiveButton } from '@/components/ui/destructive-button'
import { GhostButton } from '@/components/ui/ghost-button'
import { PrimaryButton } from '@/components/ui/primary-button'
import {
	useBillEntitySearch,
	useBillPartySearch,
	useBills,
	useCancelBill,
	useDeleteBill,
	useIssueBill,
	useRevertBillToDraft,
} from '@/hooks/useBills'
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { MRT_SortingState } from 'mantine-react-table'
import type { BillListSortDirection, BillListSortField, BillStatus, EntityType } from '@repo/bills'

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
		const deduped = new Map<
			string,
			{ id: string; value: string; label: string; description: string }
		>()
		for (const row of issuerSearch.data ?? []) {
			const key = row.entityId
			if (deduped.has(key)) continue
			deduped.set(key, {
				id: key,
				value: row.entityId,
				label: row.name || row.entityId,
				description: row.entityId,
			})
		}
		return [...deduped.values()]
	}, [issuerSearch.data])
	const payerOptions = useMemo(() => {
		const deduped = new Map<
			string,
			{ id: string; value: string; label: string; description: string }
		>()
		for (const row of payerSearch.data ?? []) {
			const key = row.entityId
			if (deduped.has(key)) continue
			deduped.set(key, {
				id: key,
				value: row.entityId,
				label: row.name || row.entityId,
				description: row.entityId,
			})
		}
		return [...deduped.values()]
	}, [payerSearch.data])
	const payeeOptions = useMemo(() => {
		const deduped = new Map<
			string,
			{ id: string; value: string; label: string; description: string }
		>()
		for (const row of payeeSearch.data ?? []) {
			const key = row.entityId
			if (deduped.has(key)) continue
			deduped.set(key, {
				id: key,
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

	// Action handlers
	const handleIssue = async (billId: string) => {
		try {
			await issueBill.mutateAsync(billId)
		} catch (error) {
			console.error('Failed to issue bill:', error)
		}
	}

	const handleCancel = async (billId: string) => {
		if (!confirm('Are you sure you want to cancel this bill?')) return
		try {
			await cancelBill.mutateAsync(billId)
		} catch (error) {
			console.error('Failed to cancel bill:', error)
		}
	}

	const handleDelete = async (billId: string) => {
		if (!confirm('Are you sure you want to delete this bill? This action cannot be undone.')) return
		try {
			await deleteBill.mutateAsync(billId)
		} catch (error) {
			console.error('Failed to delete bill:', error)
		}
	}
	const handleRevertToDraft = async (billId: string) => {
		if (!confirm('Move this bill back to draft?')) return
		try {
			await revertBillToDraft.mutateAsync(billId)
		} catch (error) {
			console.error('Failed to revert bill to draft:', error)
		}
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

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Bills Management</h1>
					<p className="text-muted-foreground mt-1">View and manage all bills</p>
				</div>
				<div className="flex gap-2">
					<GhostButton asChild>
						<Link to="/admin/bills/templates">
							<FileText className="mr-2 h-4 w-4" />
							Templates
						</Link>
					</GhostButton>
					<GhostButton asChild>
						<Link to="/admin/bills/schedules">
							<Calendar className="mr-2 h-4 w-4" />
							Schedules
						</Link>
					</GhostButton>
					<PrimaryButton asChild>
						<Link to="/admin/bills/new">
							<Plus className="mr-2 h-4 w-4" />
							Create Bill
						</Link>
					</PrimaryButton>
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
				renderActions={(bill) => (
					<div className="flex justify-end gap-2">
						{bill.status === 'draft' && (
							<ConfirmButton
								size="sm"
								showIcon={false}
								onConfirm={() => handleIssue(bill.id)}
								loading={issueBill.isPending}
							>
								Issue
							</ConfirmButton>
						)}
						{bill.status !== 'paid' && bill.status !== 'cancelled' && (
							<CancelButton
								size="sm"
								showIcon={false}
								onClick={() => void handleCancel(bill.id)}
								loading={cancelBill.isPending}
							>
								Cancel
							</CancelButton>
						)}
						{bill.status !== 'draft' && bill.status !== 'paid' && (
							<GhostButton
								size="sm"
								onClick={() => void handleRevertToDraft(bill.id)}
								disabled={revertBillToDraft.isPending}
							>
								To Draft
							</GhostButton>
						)}
						{bill.status === 'draft' && (
							<DestructiveButton
								size="sm"
								showIcon={false}
								onClick={() => void handleDelete(bill.id)}
								loading={deleteBill.isPending}
							>
								Delete
							</DestructiveButton>
						)}
						<PrimaryButton size="sm" asChild>
							<Link to={`/admin/bills/${bill.id}`}>View</Link>
						</PrimaryButton>
					</div>
				)}
				emptyMessage="No bills found for the current filters."
			/>
		</div>
	)
}
