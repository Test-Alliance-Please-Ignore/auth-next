import { Clock, Play, RefreshCw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { useMutation, useQuery } from '@tanstack/react-query'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingInline } from '@/components/ui/loading'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'

function isRunActive(status: {
	queued: number
	running: number
	waiting: number
	complete: number
	errored: number
	terminated: number
	unknown: number
}): boolean {
	return status.queued > 0 || status.running > 0 || status.waiting > 0
}

export default function AdminEveCharacterSyncPage() {
	usePageTitle('Admin - EVE Character Sync')

	const [batchId, setBatchId] = useState<string | null>(null)
	const [runSummary, setRunSummary] = useState<Awaited<
		ReturnType<typeof api.triggerManualEveCharacterSyncBatch>
	> | null>(null)

	const startMutation = useMutation({
		mutationFn: () => api.triggerManualEveCharacterSyncBatch(),
		onSuccess: (result) => {
			setRunSummary(result)
			setBatchId(result.batchId)
		},
	})

	const statusQuery = useQuery({
		queryKey: ['admin', 'eve-character-sync', 'manual-run', batchId],
		queryFn: () => api.getManualEveCharacterSyncBatchStatus(batchId as string),
		enabled: Boolean(batchId),
		refetchInterval: (query) => {
			const data = query.state.data
			if (!data) return 2000
			return isRunActive(data.statusCounts) ? 3000 : false
		},
	})

	const statusCounts = statusQuery.data?.statusCounts
	const total = statusQuery.data?.total ?? 0

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-semibold">Manual EVE Character Sync</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Manual trigger for the scheduled character sync fanout workflow.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Run Workflow</CardTitle>
					<CardDescription>
						Starts a batch run across all characters pending sync, grouped by owning user when available.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-center gap-2">
						<Button
							variant="primary"
							onClick={() => startMutation.mutate()}
							disabled={startMutation.isPending || (statusCounts ? isRunActive(statusCounts) : false)}
						>
							{startMutation.isPending ? <LoadingInline className="mr-2" /> : <Play className="mr-2 h-4 w-4" />}
							Start Sync Run
						</Button>
						{statusQuery.isFetching ? <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
					</div>

					{startMutation.isError ? (
						<div className="text-sm text-destructive">Failed to start workflow run.</div>
					) : null}

					{runSummary ? (
						<div className="text-sm text-muted-foreground space-y-1">
							<div>
								<span className="font-medium text-foreground">Batch:</span> {runSummary.batchId}
							</div>
							<div>
								<span className="font-medium text-foreground">Character count:</span> {runSummary.totalCharacters}
							</div>
							<div>
								<span className="font-medium text-foreground">Workflow instances:</span>{' '}
								{runSummary.created}/{runSummary.totalWorkflowInstances} created
							</div>
						</div>
					) : null}
				</CardContent>
			</Card>

			{statusQuery.data ? (
				<Card>
					<CardHeader>
						<CardTitle>Progress</CardTitle>
						<CardDescription>Polling every 3s while active.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex flex-wrap gap-2">
							<Badge variant="secondary">Total {total}</Badge>
							<Badge variant="secondary">Queued {statusCounts?.queued ?? 0}</Badge>
							<Badge variant="secondary">Running {statusCounts?.running ?? 0}</Badge>
							<Badge variant="secondary">Waiting {statusCounts?.waiting ?? 0}</Badge>
							<Badge variant="success">Complete {statusCounts?.complete ?? 0}</Badge>
							<Badge variant="destructive">Errored {statusCounts?.errored ?? 0}</Badge>
							<Badge variant="destructive">Terminated {statusCounts?.terminated ?? 0}</Badge>
							<Badge variant="ghost">Unknown {statusCounts?.unknown ?? 0}</Badge>
						</div>

						{statusQuery.data.failedInstances.length > 0 ? (
							<div className="space-y-2">
								<div className="flex items-center gap-2 text-sm font-medium text-destructive">
									<TriangleAlert className="h-4 w-4" />
									Failures
								</div>
								<div className="space-y-2">
									{statusQuery.data.failedInstances.map((failed) => (
										<div
											key={failed.id}
											className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
										>
											<div className="font-mono break-all">{failed.id}</div>
											<div className="text-muted-foreground">
												Status: <span className="text-foreground">{failed.status}</span>
											</div>
											{failed.error ? (
												<div className="text-destructive break-words">{failed.error}</div>
											) : null}
										</div>
									))}
								</div>
							</div>
						) : null}

						<div className="text-xs text-muted-foreground flex items-center gap-1">
							<Clock className="h-3.5 w-3.5" />
							Started: {new Date(statusQuery.data.startedAt).toLocaleString()}
						</div>
					</CardContent>
				</Card>
			) : null}
		</div>
	)
}
