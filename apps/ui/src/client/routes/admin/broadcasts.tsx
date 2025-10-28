import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DestructiveButton } from '@/components/ui/destructive-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
	useBroadcasts,
	useBroadcastTargets,
	useBroadcastTemplates,
	useDeleteBroadcast,
} from '@/hooks/useBroadcasts'
import { useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { Broadcast, BroadcastStatus } from '@/lib/api'

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

export default function AdminBroadcastsPage() {
	usePageTitle('Admin - Broadcasts')
	const [statusFilter, setStatusFilter] = useState<BroadcastStatus | 'all'>('all')
	const { data: broadcasts, isLoading } = useBroadcasts(
		undefined,
		statusFilter === 'all' ? undefined : statusFilter
	)
	const { data: groups } = useGroups()
	const { data: targets } = useBroadcastTargets()
	const { data: templates } = useBroadcastTemplates()
	const deleteBroadcast = useDeleteBroadcast()

	// Dialog state
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedBroadcast, setSelectedBroadcast] = useState<Broadcast | null>(null)

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	const handleDeleteClick = (broadcast: Broadcast) => {
		setSelectedBroadcast(broadcast)
		setDeleteDialogOpen(true)
	}

	const handleDeleteConfirm = async () => {
		if (!selectedBroadcast) return

		try {
			await deleteBroadcast.mutateAsync(selectedBroadcast.id)
			setDeleteDialogOpen(false)
			setSelectedBroadcast(null)
			setMessage({ type: 'success', text: 'Broadcast deleted successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete broadcast',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const formatDate = (dateString: string) => {
		return new Date(dateString).toLocaleString()
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">All Broadcasts</h1>
					<p className="text-muted-foreground mt-1">Monitor and manage all system broadcasts</p>
				</div>
			</div>

			{/* Success/Error Message */}
			{message && (
				<Card
					className={
						message.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Filters */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Filters</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex gap-4">
						<div className="w-48">
							<Select
								value={statusFilter}
								onValueChange={(value) => setStatusFilter(value as BroadcastStatus | 'all')}
							>
								<SelectTrigger>
									<SelectValue placeholder="Filter by status" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Statuses</SelectItem>
									<SelectItem value="draft">Draft</SelectItem>
									<SelectItem value="scheduled">Scheduled</SelectItem>
									<SelectItem value="sending">Sending</SelectItem>
									<SelectItem value="sent">Sent</SelectItem>
									<SelectItem value="failed">Failed</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Broadcasts List */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Broadcasts</CardTitle>
					<CardDescription>All broadcasts in the system</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-muted-foreground">Loading broadcasts...</p>
					) : !broadcasts || broadcasts.length === 0 ? (
						<p className="text-muted-foreground">No broadcasts found.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Status</TableHead>
									<TableHead>Group</TableHead>
									<TableHead>Target</TableHead>
									<TableHead>Template</TableHead>
									<TableHead>Created By</TableHead>
									<TableHead>Created</TableHead>
									<TableHead>Scheduled</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{broadcasts.map((broadcast) => {
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
												{broadcast.createdBy}
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{formatDate(broadcast.createdAt)}
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{broadcast.scheduledFor ? formatDate(broadcast.scheduledFor) : '-'}
											</TableCell>
											<TableCell className="text-right space-x-2">
												<Link
													to={`/admin/broadcasts/${broadcast.id}`}
													className="text-sm text-primary hover:underline"
												>
													View Details
												</Link>
												<DestructiveButton
													size="sm"
													onClick={() => handleDeleteClick(broadcast)}
													showIcon={false}
												>
													Delete
												</DestructiveButton>
											</TableCell>
										</TableRow>
									)
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Broadcast</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete this broadcast? This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedBroadcast(null)
							}}
							disabled={deleteBroadcast.isPending}
						>
							Cancel
						</CancelButton>
						<DestructiveButton
							onClick={handleDeleteConfirm}
							loading={deleteBroadcast.isPending}
							loadingText="Deleting..."
							showIcon={false}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
