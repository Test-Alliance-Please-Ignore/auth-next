import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/hooks/useAuth'
import { useBroadcasts, useBroadcastTargets, useBroadcastTemplates } from '@/hooks/useBroadcasts'
import { useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { BroadcastStatus } from '@/lib/api'

const statusColors: Record<BroadcastStatus, string> = {
	draft: 'bg-gray-500',
	scheduled: 'bg-blue-500',
	sending: 'bg-yellow-500',
	sent: 'bg-green-500',
	failed: 'bg-red-500',
}

const statusLabels: Record<BroadcastStatus, string> = {
	draft: 'Draft',
	scheduled: 'Scheduled',
	sending: 'Sending',
	sent: 'Sent',
	failed: 'Failed',
}

export default function BroadcastsPage() {
	usePageTitle('My Broadcasts')
	const navigate = useNavigate()
	const { user } = useAuth()
	const { data: broadcasts, isLoading } = useBroadcasts()
	const { data: groups } = useGroups()
	const { data: targets } = useBroadcastTargets()
	const { data: templates } = useBroadcastTemplates()

	// Filter broadcasts to only show user's own
	const myBroadcasts = broadcasts?.filter((b) => b.createdBy === user?.id) || []

	const formatDate = (dateString: string) => {
		return new Date(dateString).toLocaleString()
	}

	if (isLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<p className="text-muted-foreground">Loading broadcasts...</p>
				</div>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title="My Broadcasts"
				description="View and manage your broadcasts"
				action={
					<Button onClick={() => navigate('/broadcasts/new')}>
						<Plus className="mr-2 h-4 w-4" />
						New Broadcast
					</Button>
				}
			/>

			<Section>
				{/* Stats */}
				<div className="grid gap-4 md:grid-cols-4">
					<Card variant="interactive">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Total</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{myBroadcasts.length}</div>
						</CardContent>
					</Card>

					<Card variant="interactive">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Sent</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{myBroadcasts.filter((b) => b.status === 'sent').length}
							</div>
						</CardContent>
					</Card>

					<Card variant="interactive">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Scheduled</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{myBroadcasts.filter((b) => b.status === 'scheduled').length}
							</div>
						</CardContent>
					</Card>

					<Card variant="interactive">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Failed</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{myBroadcasts.filter((b) => b.status === 'failed').length}
							</div>
						</CardContent>
					</Card>
				</div>

				{/* Broadcasts List */}
				{myBroadcasts.length === 0 ? (
					<Card variant="interactive">
						<CardContent className="py-16 text-center">
							<div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-6">
								<Plus className="h-10 w-10 text-muted-foreground" />
							</div>
							<h3 className="text-xl font-semibold mb-2">No Broadcasts Yet</h3>
							<p className="text-muted-foreground mb-6 max-w-md mx-auto">
								You haven't created any broadcasts yet. Get started by sending your first broadcast
								message.
							</p>
							<Button onClick={() => navigate('/broadcasts/new')} size="lg">
								<Plus className="mr-2 h-4 w-4" />
								Create Your First Broadcast
							</Button>
						</CardContent>
					</Card>
				) : (
					<Card variant="interactive">
						<CardHeader>
							<CardTitle>Recent Broadcasts</CardTitle>
							<CardDescription>Your broadcast history</CardDescription>
						</CardHeader>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Status</TableHead>
										<TableHead>Group</TableHead>
										<TableHead>Target</TableHead>
										<TableHead>Template</TableHead>
										<TableHead>Created</TableHead>
										<TableHead>Scheduled</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{myBroadcasts.map((broadcast) => {
										const group = groups?.find((g) => g.id === broadcast.groupId)
										const target = targets?.find((t) => t.id === broadcast.targetId)
										const template = broadcast.templateId
											? templates?.find((t) => t.id === broadcast.templateId)
											: null
										return (
											<TableRow key={broadcast.id}>
												<TableCell>
													<Badge className={statusColors[broadcast.status]}>
														{statusLabels[broadcast.status]}
													</Badge>
												</TableCell>
												<TableCell>{group?.name || broadcast.groupId}</TableCell>
												<TableCell className="font-medium">{target?.name || broadcast.targetId}</TableCell>
												<TableCell>{template?.name || 'Custom'}</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{formatDate(broadcast.createdAt)}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{broadcast.scheduledFor ? formatDate(broadcast.scheduledFor) : '-'}
												</TableCell>
											</TableRow>
										)
									})}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				)}
			</Section>
		</Container>
	)
}
