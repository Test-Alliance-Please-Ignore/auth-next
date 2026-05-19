import { useState } from 'react'
import { Link } from 'react-router-dom'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
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

import { ScanStatusBadge } from '../components/ScanStatusBadge'
import { formatMoonScanDate } from '../date'
import { useMyScans } from '../hooks'
import { useMoonScanPermissions } from '../permissions'

import type { MoonScan } from '../types'

function ScanRow({ scan }: { scan: MoonScan }) {
	const submittedAt = formatMoonScanDate(scan.submittedAt)
	return (
		<TableRow>
			<TableCell className="font-mono text-xs text-muted-foreground">
				<Link to={`/moon-scan/moon/${scan.moonId}`} className="hover:underline text-foreground">
					{scan.moonId}
				</Link>
			</TableCell>
				<TableCell>{scan.ores.length} ore{scan.ores.length !== 1 ? 's' : ''}</TableCell>
				<TableCell>{submittedAt}</TableCell>
				<TableCell><ScanStatusBadge status={scan.status} /></TableCell>
			</TableRow>
		)
}

export default function MyScansPage() {
	const { canSubmit } = useMoonScanPermissions()

	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(20)

	const { data, isLoading, error } = useMyScans({ page, pageSize })

	if (!canSubmit) {
		return (
			<Container>
				<PageHeader title="My Scans" description="You do not have permission to view scans." />
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
			itemLabel="scans"
		/>
	)

	return (
		<Container>
			<PageHeader
				title="My Scans"
				description="Moon scans you have submitted"
			/>

			{error && (
				<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					Failed to load scans
				</div>
			)}

			<Card className="mt-section">
				{hasPagination && <div className="border-b p-4">{renderPaginationControls()}</div>}
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Moon</TableHead>
							<TableHead>Ores</TableHead>
							<TableHead>Submitted</TableHead>
							<TableHead>Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading
							? Array.from({ length: 5 }).map((_, i) => (
									<TableRow key={i}>
										{Array.from({ length: 4 }).map((__, j) => (
											<TableCell key={j}>
												<Skeleton className="h-4 w-24" />
											</TableCell>
										))}
									</TableRow>
								))
							: (data?.items ?? []).map((scan) => <ScanRow key={scan.id} scan={scan} />)}
						{!isLoading && data?.items.length === 0 && (
							<TableRow>
								<TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
									No scans submitted yet.{' '}
									<Link to="/moon-scan/submit" className="text-primary hover:underline">
										Submit your first scan
									</Link>
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
