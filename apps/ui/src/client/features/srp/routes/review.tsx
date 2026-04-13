import { Link, Navigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { RequestTable } from '../components/RequestTable'
import { usePendingRequests } from '../hooks'

export default function ReviewQueue() {
	const { hasPermission, isAdmin } = useUserPermissions()
	const { data, isLoading, error, refetch } = usePendingRequests({ limit: 50 })

	// Check permissions
	if (!(isAdmin || hasPermission('urn:srp:reviewer'))) {
		return <Navigate to="/srp" replace />
	}

	return (
		<Container>
			<PageHeader
				title="Review Queue"
				description="Review and approve ship replacement requests"
				action={
					<Button variant="ghost" onClick={() => refetch()}>
						Refresh
					</Button>
				}
			/>

			{error ? (
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">Failed to load pending requests</p>
					<p className="text-xs text-muted-foreground">
						{error instanceof Error ? error.message : 'Unknown error'}
					</p>
					<Button variant="ghost" className="mt-4" onClick={() => refetch()}>
						Retry
					</Button>
				</div>
			) : data && data.requests.length === 0 ? (
				<div className="rounded-lg border border-dashed p-12 text-center">
					<h3 className="mb-2 font-semibold">All caught up!</h3>
					<p className="text-sm text-muted-foreground">No requests pending review. Great work!</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/srp">Back to Dashboard</Link>
					</Button>
				</div>
			) : (
				<>
					<RequestTable requests={data?.requests || []} isLoading={isLoading} />
					{data && data.total > 0 && (
						<div className="mt-4 text-sm text-muted-foreground">
							Showing {data.requests.length} of {data.total} pending requests
						</div>
					)}
				</>
			)}
		</Container>
	)
}
