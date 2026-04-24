import { Ban, ExternalLink, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { RescindBroadcastDialog } from './rescind-broadcast-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
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
	useSendBroadcast,
} from '@/hooks/useBroadcasts'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { getBroadcastActionVisibility } from '@/lib/broadcast-permissions'

import type { BadgeVariant } from '@/components/ui/badge'
import type { Broadcast, BroadcastStatus } from '@/lib/api'

const statusVariants: Record<BroadcastStatus, BadgeVariant> = {
	draft: 'secondary',
	scheduled: 'default',
	sending: 'warning',
	sent: 'success',
	failed: 'destructive',
	rescinded: 'warning',
}

const statusLabels: Record<BroadcastStatus, string> = {
	draft: 'Draft',
	scheduled: 'Scheduled',
	sending: 'Sending',
	sent: 'Sent',
	failed: 'Failed',
	rescinded: 'Rescinded',
}

export default function BroadcastsPage() {
	usePageTitle('My Broadcasts')

	const pageSize = 25
	const navigate = useNavigate()
	const [page, setPage] = useState(0)
	const { user, permissions } = useAuth()

	const { data: broadcastsPage, isLoading } = useBroadcasts(undefined, undefined, {
		mine: true,
		limit: pageSize,
		offset: page * pageSize,
	})
	const { data: targets } = useBroadcastTargets()
	const { data: templates } = useBroadcastTemplates()
	const sendBroadcast = useSendBroadcast()
	const deleteBroadcast = useDeleteBroadcast()
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [rescindDialogOpen, setRescindDialogOpen] = useState(false)
	const [selectedBroadcast, setSelectedBroadcast] = useState<Broadcast | null>(null)

	const myBroadcasts = broadcastsPage?.rows ?? []
	const rowCount = broadcastsPage?.rowCount ?? 0
	const totalPages = Math.max(1, Math.ceil(rowCount / pageSize))
	const maxPage = Math.max(totalPages - 1, 0)

	useEffect(() => {
		if (page > maxPage) {
			setPage(maxPage)
		}
	}, [page, maxPage])

	const formatDate = (dateString: string) => {
		return new Date(dateString).toLocaleString()
	}

	const handleSendNow = async (broadcast: Broadcast) => {
		try {
			await sendBroadcast.mutateAsync(broadcast.id)
		} catch {
			// Error is surfaced by API layer/toasts in app shell; keep row action simple
		}
	}

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
		} catch {
			// Error is surfaced by API layer/toasts in app shell; keep dialog state
		}
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
						<Plus className="h-4 w-4" />
						New Broadcast
					</Button>
				}
			/>

			<Section>
				<div className="grid gap-4 md:grid-cols-4">
					<Card variant="elevated">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Total</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{rowCount}</div>
						</CardContent>
					</Card>

					<Card variant="elevated">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Sent</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{myBroadcasts.filter((b) => b.status === 'sent').length}
							</div>
						</CardContent>
					</Card>

					<Card variant="elevated">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Scheduled</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{myBroadcasts.filter((b) => b.status === 'scheduled').length}
							</div>
						</CardContent>
					</Card>

					<Card variant="elevated">
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

				{rowCount === 0 ? (
					<Card variant="elevated">
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
								<Plus className="h-4 w-4" />
								Create Your First Broadcast
							</Button>
						</CardContent>
					</Card>
				) : (
					<Card variant="elevated">
						<CardHeader>
							<CardTitle>Recent Broadcasts</CardTitle>
							<CardDescription>Your broadcast history</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="rounded-md border bg-card">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Status</TableHead>
										<TableHead>Target</TableHead>
										<TableHead>Template</TableHead>
										<TableHead>Created</TableHead>
										<TableHead>Scheduled</TableHead>
										<TableHead className="sticky right-0 z-20 bg-primary/5 border-l border-border/50 text-right">
											Actions
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{myBroadcasts.map((broadcast) => {
										const target = targets?.find((t) => t.id === broadcast.targetId)
										const template = broadcast.templateId
											? templates?.find((t) => t.id === broadcast.templateId)
											: null
										const { canDelete, canRescind } = getBroadcastActionVisibility({
											user,
											permissions,
											broadcast,
											target,
										})

										return (
											<TableRow key={broadcast.id}>
												<TableCell>
													<Badge variant={statusVariants[broadcast.status]}>
														{statusLabels[broadcast.status]}
													</Badge>
												</TableCell>
												<TableCell className="font-medium">
													{target?.name || broadcast.targetId}
												</TableCell>
												<TableCell>{template?.name || 'Custom'}</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{formatDate(broadcast.createdAt)}
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{broadcast.scheduledFor ? formatDate(broadcast.scheduledFor) : '-'}
												</TableCell>
												<TableCell className="sticky right-0 z-10 bg-card border-l border-border/50 text-right">
													<div className="flex items-center justify-end gap-2">
														<Link to={`/broadcasts/${broadcast.id}`}>
															<Button variant="ghost" size="sm" title="Show details">
																<ExternalLink className="h-4 w-4" />
															</Button>
														</Link>
														{broadcast.status === 'draft' && (
															<Button
																variant="ghost"
																size="sm"
																onClick={() => navigate(`/broadcasts/new?draftId=${broadcast.id}`)}
																title="Edit draft"
															>
																<Pencil className="h-4 w-4" />
															</Button>
														)}
														{['draft', 'scheduled', 'failed'].includes(broadcast.status) && (
															<Button
																variant="ghost"
																size="sm"
																onClick={() => handleSendNow(broadcast)}
																disabled={sendBroadcast.isPending}
																title="Send now"
															>
																<Send className="h-4 w-4 text-confirm" />
															</Button>
														)}
														{canRescind && (
															<Button
																variant="ghost"
																size="sm"
																onClick={() => { setSelectedBroadcast(broadcast); setRescindDialogOpen(true) }}
																title="Rescind broadcast"
															>
																<Ban className="h-4 w-4 text-warning" />
															</Button>
														)}
														{canDelete && (
															<Button
																variant="ghost"
																size="sm"
																onClick={() => handleDeleteClick(broadcast)}
																disabled={deleteBroadcast.isPending}
																title="Delete broadcast"
															>
																<Trash2 className="h-4 w-4 text-destructive" />
															</Button>
														)}
													</div>
												</TableCell>
											</TableRow>
										)
									})}
								</TableBody>
							</Table>
							</div>
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
						</CardContent>
					</Card>
				)}
			</Section>

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
							<Trash2 className="h-4 w-4" />
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<RescindBroadcastDialog
				broadcastId={selectedBroadcast?.id ?? ""}
				open={rescindDialogOpen}
				onOpenChange={(open) => {
					setRescindDialogOpen(open)
					if (!open) setSelectedBroadcast(null)
				}}
			/>
		</Container>
	)
}
