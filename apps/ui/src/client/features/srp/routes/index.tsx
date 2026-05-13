import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePageTitle } from '@/hooks/usePageTitle'

import { LossTable } from '../components/LossTable'
import { RequestTable } from '../components/RequestTable'
import { useMyRequests, useRecentLosses, useRefreshKillmails, useSRPConfig } from '../hooks'

import type { LossWithSRPStatus } from '../types'

export default function SRPIndex() {
	usePageTitle('SRP')

	const {
		data: losses,
		isLoading: lossesLoading,
		error: lossesError,
		failedCharacters: loadFailures,
	} = useRecentLosses(60)
	const refreshMutation = useRefreshKillmails()
	const { data: config } = useSRPConfig()
	const {
		data: requestsData,
		isLoading: requestsLoading,
		error: requestsError,
	} = useMyRequests({ limit: 10 })

	return (
		<Container>
			<PageHeader
				title="Ship Replacement Program"
				description="Request reimbursement for ship losses"
			/>

			<Card className="mt-section">
				<CardContent className="p-0">
				<Tabs defaultValue="losses">
					<TabsList className="w-full rounded-b-none border-b">
						<TabsTrigger value="losses">Recent Losses</TabsTrigger>
						<TabsTrigger value="requests">My Requests</TabsTrigger>
					</TabsList>

					<div className="p-4">
						<TabsContent value="losses" className="mt-0 space-y-4">
							{lossesError && !lossesLoading ? (
								<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-center">
									<p className="text-sm text-red-500">Failed to load losses</p>
									<p className="text-xs text-muted-foreground">
										{lossesError instanceof Error ? lossesError.message : 'Unknown error'}
									</p>
								</div>
							) : (
								<LossTable
									losses={(losses || []) as LossWithSRPStatus[]}
									isLoading={lossesLoading}
									isRefreshing={refreshMutation.isPending}
									onRefresh={() => refreshMutation.mutate()}
									config={config}
									refreshResults={refreshMutation.data?.results}
									loadFailures={loadFailures}
								/>
							)}
						</TabsContent>

						<TabsContent value="requests" className="mt-0 space-y-4">
							{requestsError && !requestsLoading ? (
								<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-center">
									<p className="text-sm text-red-500">Failed to load requests</p>
									<p className="text-xs text-muted-foreground">
										{requestsError instanceof Error ? requestsError.message : 'Unknown error'}
									</p>
								</div>
							) : (
								<RequestTable requests={requestsData?.requests || []} isLoading={requestsLoading} />
							)}
						</TabsContent>

					</div>
				</Tabs>
				</CardContent>
			</Card>
		</Container>
	)
}
