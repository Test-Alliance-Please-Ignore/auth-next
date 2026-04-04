import { ExternalLink, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	useBroadcasts,
	useBroadcastTargets,
	useBroadcastTemplates,
	useDeleteBroadcast,
} from '@/hooks/useBroadcasts'
import { useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { BadgeVariant } from '@/components/ui/badge'
import type { Broadcast, BroadcastStatus } from '@/lib/api'

const statusVariants: Record<BroadcastStatus, BadgeVariant> = {
	draft: 'secondary',
	scheduled: 'default',
	sending: 'warning',
	sent: 'success',
	failed: 'destructive',
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

	const pageSize = 25
	const [statusFilter, setStatusFilter] = useState<BroadcastStatus | 'all'>('all')
	const [page, setPage] = useState(0)

	const { data: broadcastsPage, isLoading } = useBroadcasts(
		undefined,
		statusFilter === 'all' ? undefined : statusFilter,
		{
			limit: pageSize,
			offset: page * pageSize,
		}
	)
	const { data: groups } = useGroups()
	const { data: targets } = useBroadcastTargets()
	const { data: templates } = useBroadcastTemplates()
	const deleteBroadcast = useDeleteBroadcast()

	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedBroadcast, setSelectedBroadcast] = useState<Broadcast | null>(null)
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	const broadcasts = broadcastsPage?.rows ?? []
	const rowCount = broadcastsPage?.rowCount ?? 0
	const totalPages = Math.max(1, Math.ceil(rowCount / pageSize))
	const maxPage = Math.max(totalPages - 1, 0)

	useEffect(() => {
		setPage(0)
	}, [statusFilter])

	useEffect(() => {
		if (page > maxPage) {
			setPage(maxPage)
		}
	}, [page, maxPage])

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
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">All Broadcasts</h1>
					<p className="text-muted-foreground mt-1">Monitor and manage all system broadcasts</p>
				</div>
			</div>

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

			<Card variant="elevated">
				<CardHeader>
					<CardTitle>Filters</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex gap-4">
						<div className="w-48">
							<Select
								value={statusFilter}
								onValueChange={(value) => setStatusFilter(value as BroadcastStatus | 'all')}
								options={[
									{ value: 'all', label: 'All Statuses' },
									{ value: 'draft', label: 'Draft' },
									{ value: 'scheduled', label: 'Scheduled' },
									{ value: 'sending', label: 'Sending' },
									{ value: 'sent', label: 'Sent' },
									{ value: 'failed', label: 'Failed' },
								]}
								placeholder="Filter by status"
							/>
						</div>
					</div>
				</CardContent>
			</Card>

			<Card variant="elevated">
				<CardHeader>
					<CardTitle>Broadcasts</CardTitle>
					<CardDescription>All broadcasts in the system</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-muted-foreground">Loading broadcasts...</p>
					) : broadcasts.length === 0 ? (
						<p className="text-muted-foreground">No broadcasts found.</p>
					) : (
						<>
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
										<TableHead className="sticky right-0 z-20 bg-card border-l border-border/50 text-right">
											Actions
										</TableHead>
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
													<Badge variant={statusVariants[broadcast.status]}>
														{statusLabels[broadcast.status]}
													</Badge>
												</TableCell>
												<TableCell>{group?.name || broadcast.groupId}</TableCell>
												<TableCell className="font-medium">
													{target?.name || broadcast.targetId}
												</TableCell>
												<TableCell>{template?.name || 'Custom'}</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{broadcast.createdByCharacterName || broadcast.createdBy}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{formatDate(broadcast.createdAt)}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{broadcast.scheduledFor ? formatDate(broadcast.scheduledFor) : '-'}
												</TableCell>
												<TableCell className="sticky right-0 z-10 bg-card border-l border-border/50 text-right">
													<div className="flex items-center justify-end gap-2">
														<Link to={`/admin/broadcasts/${broadcast.id}`}>
															<Button variant="ghost" size="sm" title="Show details">
																<ExternalLink className="h-4 w-4" />
															</Button>
														</Link>
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handleDeleteClick(broadcast)}
															title="Delete broadcast"
														>
															<Trash2 className="h-4 w-4 text-destructive" />
														</Button>
													</div>
												</TableCell>
											</TableRow>
										)
									})}
								</TableBody>
							</Table>
							<div className="mt-4 flex items-center justify-between gap-2">
								<p className="text-sm text-muted-foreground">
									Showing {Math.min(page * pageSize + 1, rowCount)}-
									{Math.min((page + 1) * pageSize, rowCount)} of {rowCount}
								</p>
								<div className="flex items-center gap-2">
									<Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
										Previous
									</Button>
									<p className="text-sm text-muted-foreground">
										Page {page + 1} of {totalPages}
									</p>
									<Button
										variant="ghost"
										disabled={page >= maxPage}
										onClick={() => setPage(page + 1)}
									>
										Next
									</Button>
								</div>
							</div>
						</>
					)}
				</CardContent>
			</Card>

			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Broadcast</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete this broadcast? This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedBroadcast(null)
							}}
							disabled={deleteBroadcast.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteConfirm}
							loading={deleteBroadcast.isPending}
							loadingText="Deleting..."
							showIcon={false}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
