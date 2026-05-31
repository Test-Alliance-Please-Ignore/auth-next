import { useState } from 'react'
import { Link } from 'react-router-dom'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { usePageTitle } from '@/hooks/usePageTitle'

import { formatMoonScanDate } from '../date'
import { useRejectScan, useScanQueue, useVerifyScan } from '../hooks'
import { useMoonScanPermissions } from '../permissions'

import type { MoonScan } from '../types'

function ValidationActions({ scan }: { scan: MoonScan }) {
	const [notes, setNotes] = useState('')
	const [expanded, setExpanded] = useState(false)

	const verifyMutation = useVerifyScan()
	const rejectMutation = useRejectScan()

	const isPending = verifyMutation.isPending || rejectMutation.isPending

	function handleVerify() {
		verifyMutation.mutate({ id: scan.id, notes: notes || undefined })
		setExpanded(false)
		setNotes('')
	}

	function handleReject() {
		rejectMutation.mutate({ id: scan.id, notes: notes || undefined })
		setExpanded(false)
		setNotes('')
	}

	return (
		<div className="space-y-2">
			{expanded && (
				<Textarea
					placeholder="Optional notes..."
					className="h-16 text-xs"
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
				/>
			)}
			<div className="flex items-center gap-2">
				<Button
					size="sm"
					className="bg-green-600 hover:bg-green-700 text-white"
					disabled={isPending}
					onClick={handleVerify}
				>
					{verifyMutation.isPending ? 'Verifying…' : 'Verify'}
				</Button>
				<Button
					size="sm"
					variant="destructive"
					disabled={isPending}
					onClick={handleReject}
				>
					{rejectMutation.isPending ? 'Rejecting…' : 'Reject'}
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => setExpanded((v) => !v)}
				>
					{expanded ? 'Hide notes' : 'Add note'}
				</Button>
			</div>
		</div>
	)
}

function QueueRow({ scan }: { scan: MoonScan }) {
	const submittedAt = formatMoonScanDate(scan.submittedAt)
	return (
		<TableRow>
			<TableCell className="font-mono text-xs">
				<Link to={`/moon-scan/moon/${scan.moonId}`} className="hover:underline text-foreground">
					{scan.moonId}
				</Link>
			</TableCell>
			<TableCell className="text-muted-foreground text-xs">
				{scan.submittedBy ?? '—'}
			</TableCell>
			<TableCell className="text-xs">{submittedAt}</TableCell>
			<TableCell>
				<div className="flex flex-wrap gap-1">
					{scan.ores.map((ore) => (
						<Badge key={ore.oreTypeId} variant="ghost" className="font-mono text-xs">
							{ore.oreTypeId} {(parseFloat(ore.quantity) * 100).toFixed(1)}%
						</Badge>
					))}
				</div>
			</TableCell>
			<TableCell>
				<ValidationActions scan={scan} />
			</TableCell>
		</TableRow>
	)
}

export default function QueuePage() {
	usePageTitle('Moon Scan Review Queue')

	const { canValidate } = useMoonScanPermissions()

	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(20)

	const { data, isLoading, error } = useScanQueue({ page, pageSize })

	if (!canValidate) {
		return (
			<Container>
				<PageHeader title="Validation Queue" description="You do not have permission to validate scans." />
			</Container>
		)
	}

	const totalCount = data?.total ?? 0
	const hasPagination = Math.ceil(totalCount / pageSize) > 1

	const renderPaginationControls = () => (
		<UserSearchPaginationControls
			totalCount={totalCount}
			page={page}
			pageSize={pageSize}
			onPageChange={setPage}
			onPageSizeChange={(nextPageSize) => {
				setPageSize(nextPageSize)
				setPage(1)
			}}
			pageSizeOptions={[20, 50, 100]}
			itemLabel="pending scans"
		/>
	)

	return (
		<Container>
			<PageHeader
				title="Validation Queue"
				description="Review and approve pending moon scan submissions"
			/>

			{error && (
				<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					Failed to load queue
				</div>
			)}

			<Card className="mt-section">
				{hasPagination && <div className="border-b p-4">{renderPaginationControls()}</div>}
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Moon</TableHead>
							<TableHead>Submitted by</TableHead>
							<TableHead>Date</TableHead>
							<TableHead>Composition</TableHead>
							<TableHead>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading
							? Array.from({ length: 5 }).map((_, i) => (
									<TableRow key={i}>
										{Array.from({ length: 5 }).map((__, j) => (
											<TableCell key={j}>
												<Skeleton className="h-4 w-20" />
											</TableCell>
										))}
									</TableRow>
								))
							: (data?.items ?? []).map((scan) => <QueueRow key={scan.id} scan={scan} />)}
						{!isLoading && data?.items.length === 0 && (
							<TableRow>
								<TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
									No pending scans to review.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>

				{hasPagination && <div className="border-t p-4">{renderPaginationControls()}</div>}
			</Card>
		</Container>
	)
}
