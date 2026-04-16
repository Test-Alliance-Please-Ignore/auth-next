import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { BillListFilters } from '@/components/bills/bill-list-filters'
import { BillListGrid } from '@/components/bills/bill-list-grid'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'

import { useMyBillPartySearch, useMyBills } from '../hooks'

import type { MRT_SortingState } from 'mantine-react-table'
import type { BillListSortDirection, BillListSortField, BillStatus, EntityType } from '@repo/bills'
import { Button } from '@/components/ui/button'

export default function MyBillsPage() {
	usePageTitle('My Bills')
	const navigate = useNavigate()
	const [status, setStatus] = useState<BillStatus | undefined>(undefined)
	const [payerType, setPayerType] = useState<EntityType | undefined>(undefined)
	const [payeeType, setPayeeType] = useState<EntityType | undefined>(undefined)
	const [payerId, setPayerId] = useState<string | undefined>(undefined)
	const [payeeId, setPayeeId] = useState<string | undefined>(undefined)
	const [payerQuery, setPayerQuery] = useState('')
	const [payeeQuery, setPayeeQuery] = useState('')
	const [dueAfter, setDueAfter] = useState('')
	const [dueBefore, setDueBefore] = useState('')
	const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
	const [sorting, setSorting] = useState<MRT_SortingState>([{ id: 'dueDate', desc: false }])
	const debouncedPayerQuery = useDebounce(payerQuery, 300)
	const debouncedPayeeQuery = useDebounce(payeeQuery, 300)
	const sortBy = (sorting[0]?.id ?? 'dueDate') as BillListSortField
	const sortDir = sorting[0]?.desc ? 'desc' : 'asc'
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
	const pageCount = Math.max(
		1,
		Math.ceil((billPage.data?.rowCount ?? 0) / Math.max(1, pagination.pageSize))
	)
	const resetFilters = () => {
		setStatus(undefined)
		setPayerType(undefined)
		setPayeeType(undefined)
		setPayerId(undefined)
		setPayeeId(undefined)
		setPayerQuery('')
		setPayeeQuery('')
		setDueAfter('')
		setDueBefore('')
		setPagination((prev) => ({ ...prev, pageIndex: 0 }))
	}
	const rows = billPage.data?.rows ?? []

	return (
		<Container>
			<PageHeader title="My Bills" description="View bills assigned to you or your corporations" />
			<div className="space-y-6">
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
					pageCount={pageCount}
					rowCount={billPage.data?.rowCount ?? 0}
					onRowClick={(bill) => {
						void navigate(`/my-bills/${bill.id}`)
					}}
					renderActions={(bill) => (
						<Button variant="primary" size="sm" type="button" onClick={() => navigate(`/my-bills/${bill.id}`)}>
							View
						</Button>
					)}
					emptyMessage="No bills found for the current filters."
				/>
			</div>
		</Container>
	)
}
