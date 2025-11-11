import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/useAuth'
import { Link } from 'react-router-dom'
import { LossTable } from '../components/LossTable'
import { RequestTable } from '../components/RequestTable'
import { useMyRequests, useRecentLosses } from '../hooks'
import type { LossWithSRPStatus } from '../types'
import { isSRPPayer, isSRPReviewer } from '../utils'

export default function SRPIndex() {
	const { user } = useAuth()

	// Get recent losses for all user's characters
	const {
		data: losses,
		isLoading: lossesLoading,
		error: lossesError,
	} = useRecentLosses(30)

	// Get user's recent requests
	const {
		data: requestsData,
		isLoading: requestsLoading,
		error: requestsError,
	} = useMyRequests({ limit: 10 })

	const isReviewer = isSRPReviewer(user)
	const isPayer = isSRPPayer(user)

	return (
		<Container>
			<PageHeader
				title="Ship Replacement Program"
				description="Request reimbursement for ship losses"
				action={
					<Button asChild>
						<Link to="/srp/my-requests">View All My Requests</Link>
					</Button>
				}
			/>

			<Tabs defaultValue="losses" className="mt-section">
				<TabsList className="w-full">
					<TabsTrigger value="losses">Recent Losses</TabsTrigger>
					<TabsTrigger value="requests">My Requests</TabsTrigger>
					{isReviewer && <TabsTrigger value="review">Review Queue</TabsTrigger>}
					{isPayer && <TabsTrigger value="payments">Payments</TabsTrigger>}
				</TabsList>

				<TabsContent value="losses" className="space-y-4">
					{lossesError && !lossesLoading ? (
						<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-center">
							<p className="text-sm text-red-500">Failed to load losses</p>
							<p className="text-xs text-muted-foreground">
								{lossesError instanceof Error ? lossesError.message : 'Unknown error'}
							</p>
						</div>
					) : (
						<LossTable losses={(losses || []) as LossWithSRPStatus[]} isLoading={lossesLoading} />
					)}
				</TabsContent>

				<TabsContent value="requests" className="space-y-4">
					{requestsError && !requestsLoading ? (
						<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-center">
							<p className="text-sm text-red-500">Failed to load requests</p>
							<p className="text-xs text-muted-foreground">
								{requestsError instanceof Error ? requestsError.message : 'Unknown error'}
							</p>
						</div>
					) : (
						<>
							<RequestTable
								requests={requestsData?.requests || []}
								isLoading={requestsLoading}
							/>
							{requestsData && requestsData.total > 10 && (
								<div className="text-center">
									<Button variant="outline" asChild>
										<Link to="/srp/my-requests">
											View All ({requestsData.total} requests)
										</Link>
									</Button>
								</div>
							)}
						</>
					)}
				</TabsContent>

				{isReviewer && (
					<TabsContent value="review">
						<div className="text-center">
							<Button asChild>
								<Link to="/srp/review">Go to Review Queue</Link>
							</Button>
						</div>
					</TabsContent>
				)}

				{isPayer && (
					<TabsContent value="payments">
						<div className="text-center">
							<Button asChild>
								<Link to="/srp/payments">Go to Payment Queue</Link>
							</Button>
						</div>
					</TabsContent>
				)}
			</Tabs>
		</Container>
	)
}
