import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { useMyScans } from '../hooks'

import type { MoonScan, MoonScanStatus } from '../types'

function statusBadge(status: MoonScanStatus) {
	if (status === 'verified') return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Verified</Badge>
	if (status === 'rejected') return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Rejected</Badge>
	return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pending</Badge>
}

function ScanRow({ scan }: { scan: MoonScan }) {
	const submittedAt = new Date(scan.submittedAt).toLocaleDateString()
	return (
		<TableRow>
			<TableCell className="font-mono text-xs text-muted-foreground">
				<Link to={`/moon-scan/moon/${scan.moonId}`} className="hover:underline text-foreground">
					{scan.moonId}
				</Link>
			</TableCell>
			<TableCell>{scan.ores.length} ore{scan.ores.length !== 1 ? 's' : ''}</TableCell>
			<TableCell>{submittedAt}</TableCell>
			<TableCell>{statusBadge(scan.status)}</TableCell>
		</TableRow>
	)
}

export default function MyScansPage() {
	const { hasPermission, isAdmin } = useUserPermissions()
	const canSubmit = isAdmin || hasPermission('urn:moons:submit')

	const [page, setPage] = useState(1)
	const pageSize = 20

	const { data, isLoading, error } = useMyScans({ page, pageSize })

	if (!canSubmit) {
		return (
			<Container>
				<PageHeader title="My Scans" description="You do not have permission to view scans." />
			</Container>
		)
	}

	const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1

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

			<div className="mt-section rounded-md border bg-card">
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

				{totalPages > 1 && (
					<div className="flex items-center justify-between border-t px-4 py-3">
						<p className="text-xs text-muted-foreground">
							{data?.total ?? 0} total scans
						</p>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={page <= 1}
								onClick={() => setPage((p) => p - 1)}
							>
								Previous
							</Button>
							<span className="text-xs text-muted-foreground">
								{page} / {totalPages}
							</span>
							<Button
								variant="outline"
								size="sm"
								disabled={page >= totalPages}
								onClick={() => setPage((p) => p + 1)}
							>
								Next
							</Button>
						</div>
					</div>
				)}
			</div>
		</Container>
	)
}
