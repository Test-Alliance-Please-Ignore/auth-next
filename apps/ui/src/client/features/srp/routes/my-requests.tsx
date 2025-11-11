import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Link } from 'react-router-dom'
import { RequestTable } from '../components/RequestTable'
import { useMyRequests } from '../hooks'

export default function MyRequests() {
	const { data, isLoading, error } = useMyRequests({ limit: 50 })

	return (
		<Container>
			<PageHeader
				title="My SRP Requests"
				description="View and track your ship replacement requests"
				action={
					<Button asChild>
						<Link to="/srp">Back to Dashboard</Link>
					</Button>
				}
			/>

			{error ? (
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">Failed to load requests</p>
					<p className="text-xs text-muted-foreground">
						{error instanceof Error ? error.message : 'Unknown error'}
					</p>
				</div>
			) : (
				<>
					<RequestTable requests={data?.requests || []} isLoading={isLoading} />
					{data && data.total > 0 && (
						<div className="mt-4 text-sm text-muted-foreground">
							Showing {data.requests.length} of {data.total} requests
						</div>
					)}
				</>
			)}
		</Container>
	)
}
