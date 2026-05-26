import { ArrowLeft, Ban, Edit3, FilePlus2, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { renderDiscordContentValue } from '@/components/discord-content-renderer'
import { AddBroadcastAddendumDialog } from '../add-broadcast-addendum-dialog'
import { RescindBroadcastDialog } from '../rescind-broadcast-dialog'
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	useBroadcast,
	useBroadcastDeliveries,
	useBroadcastTargets,
	useDeleteBroadcast,
	useSendBroadcast,
} from '@/hooks/useBroadcasts'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDateTimeLocal } from '@/lib/discord-time'

import type { BadgeVariant } from '@/components/ui/badge'
import type { BroadcastStatus, DeliveryStatus } from '@/lib/api'

const statusVariants: Record<BroadcastStatus, BadgeVariant> = {
	draft: 'secondary',
	scheduled: 'default',
	sending: 'warning',
	sent: 'success',
	failed: 'destructive',
	rescinded: 'warning',
}

const deliveryStatusVariants: Record<DeliveryStatus, BadgeVariant> = {
	pending: 'ghost',
	sent: 'success',
	failed: 'destructive',
}

export default function AdminBroadcastDetailPage() {
	const navigate = useNavigate()
	const { broadcastId } = useParams<{ broadcastId: string }>()
	const { data: broadcast, isLoading, refetch } = useBroadcast(broadcastId || '')
	const { data: deliveries, isLoading: isLoadingDeliveries } = useBroadcastDeliveries(
		broadcastId || ''
	)
	const { data: targets } = useBroadcastTargets()
	const sendBroadcast = useSendBroadcast()
	const deleteBroadcast = useDeleteBroadcast()
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [rescindDialogOpen, setRescindDialogOpen] = useState(false)
	const [addendumDialogOpen, setAddendumDialogOpen] = useState(false)
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	usePageTitle(
		broadcast ? `Admin - Broadcast ${broadcast.id.slice(0, 8)}` : 'Admin - Broadcast Details'
	)

	if (isLoading) {
		return (
			<div className="py-8 text-center text-muted-foreground">Loading broadcast details...</div>
		)
	}

	if (!broadcast) {
		return (
			<Card className="border-destructive bg-destructive/10">
				<CardContent className="py-8 text-center">
					<p className="text-destructive font-medium">Broadcast not found</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/admin/broadcasts">
							<ArrowLeft className="h-4 w-4" />
							Back to Broadcasts
						</Link>
					</Button>
				</CardContent>
			</Card>
		)
	}

	const targetName =
		broadcast.target?.name ||
		targets?.find((target) => target.id === broadcast.targetId)?.name ||
		broadcast.targetId
	const isSendable = ['draft', 'scheduled', 'failed'].includes(broadcast.status)
	const isEditable = broadcast.status === 'draft'

	const handleSendNow = async () => {
		try {
			await sendBroadcast.mutateAsync(broadcast.id)
			setMessage({ type: 'success', text: 'Broadcast queued for sending.' })
			await refetch()
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to send broadcast',
			})
		}
	}

	const handleDelete = async () => {
		try {
			await deleteBroadcast.mutateAsync(broadcast.id)
			navigate('/admin/broadcasts')
		} catch (error) {
			setDeleteDialogOpen(false)
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete broadcast',
			})
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-3">
				<Button variant="ghost" size="sm" asChild>
					<Link to="/admin/broadcasts">
						<ArrowLeft className="h-4 w-4" />
						Back to Broadcasts
					</Link>
				</Button>
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => refetch()}
						disabled={isLoading || sendBroadcast.isPending || deleteBroadcast.isPending}
						title="Refresh"
					>
						<RefreshCw className="h-4 w-4" />
					</Button>
					{isSendable && (
						<Button
							variant="confirm"
							size="sm"
							onClick={handleSendNow}
							loading={sendBroadcast.isPending}
							loadingText="Sending..."
							showIcon={false}
						>
							<Send className="h-4 w-4" />
							Send Now
						</Button>
					)}
					{isEditable && (
						<Button
							variant="secondary"
							size="sm"
							onClick={() => navigate(`/broadcasts/new?draftId=${broadcast.id}`)}
							showIcon={false}
						>
							<Edit3 className="h-4 w-4" />
							Edit Draft
						</Button>
					)}
					{broadcast.status === 'sent' && (
						<Button
							variant="primary"
							size="sm"
							onClick={() => setAddendumDialogOpen(true)}
							showIcon={false}
						>
							<FilePlus2 className="h-4 w-4" />
							Add Addendum
						</Button>
					)}
					{broadcast.status === 'sent' && (
						<Button
							variant="cancel"
							size="sm"
							onClick={() => setRescindDialogOpen(true)}
							showIcon={false}
						>
							<Ban className="h-4 w-4" />
							Rescind
						</Button>
					)}
					<Button
						variant="destructive"
						size="sm"
						onClick={() => setDeleteDialogOpen(true)}
						disabled={deleteBroadcast.isPending}
						showIcon={false}
					>
						<Trash2 className="h-4 w-4" />
						Delete
					</Button>
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
					<div className="flex items-center justify-between gap-4">
						<div>
							<CardTitle>Broadcast Details</CardTitle>
							<CardDescription>ID: {broadcast.id}</CardDescription>
						</div>
						<Badge variant={statusVariants[broadcast.status]}>{broadcast.status}</Badge>
					</div>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-2">
					<div>
						<div className="text-sm text-muted-foreground">Title</div>
						<div className="font-medium">{broadcast.title}</div>
					</div>
					<div>
						<div className="text-sm text-muted-foreground">Created By</div>
						<div className="font-medium">
							{broadcast.createdByCharacterName || broadcast.createdBy}
						</div>
					</div>
					<div>
						<div className="text-sm text-muted-foreground">Target</div>
						<div className="font-medium">{targetName}</div>
					</div>
					<div>
						<div className="text-sm text-muted-foreground">Template</div>
						<div className="font-medium">
							{broadcast.template?.name || (broadcast.templateId ? broadcast.templateId : 'Custom')}
						</div>
					</div>
					<div>
						<div className="text-sm text-muted-foreground">Created</div>
						<div className="font-medium">{formatDateTimeLocal(broadcast.createdAt)}</div>
					</div>
					<div>
						<div className="text-sm text-muted-foreground">Scheduled</div>
						<div className="font-medium">{formatDateTimeLocal(broadcast.scheduledFor)}</div>
					</div>
					<div>
						<div className="text-sm text-muted-foreground">Sent</div>
						<div className="font-medium">{formatDateTimeLocal(broadcast.sentAt)}</div>
					</div>
				</CardContent>
			</Card>

			<Card variant="elevated">
				<CardHeader>
					<CardTitle>Content</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						{Object.entries(broadcast.content).map(([key, value]) => (
							<div key={key} className="rounded-md border bg-muted/30 p-3">
								<div className="text-xs uppercase tracking-wide text-muted-foreground">{key}</div>
								<div className="mt-1 text-sm font-medium break-words leading-relaxed">
									{renderDiscordContentValue(value, key)}
								</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			<Card variant="elevated">
				<CardHeader>
					<CardTitle>Deliveries</CardTitle>
					<CardDescription>Delivery attempts for this broadcast</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoadingDeliveries ? (
						<p className="text-muted-foreground">Loading deliveries...</p>
					) : !deliveries || deliveries.length === 0 ? (
						<p className="text-muted-foreground">No deliveries recorded.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Status</TableHead>
									<TableHead>Target</TableHead>
									<TableHead>Sent</TableHead>
									<TableHead>Error</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{deliveries.map((delivery) => (
									<TableRow key={delivery.id}>
										<TableCell>
											<Badge variant={deliveryStatusVariants[delivery.status]}>
												{delivery.status}
											</Badge>
										</TableCell>
										<TableCell>
											{delivery.target?.name ||
												targets?.find((target) => target.id === delivery.targetId)?.name ||
												delivery.targetId}
										</TableCell>
										<TableCell>{formatDateTimeLocal(delivery.sentAt)}</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{delivery.errorMessage || '-'}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
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
						<Button variant="cancel" onClick={() => setDeleteDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
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
				broadcastId={broadcast.id}
				open={rescindDialogOpen}
				onOpenChange={setRescindDialogOpen}
				onSuccess={async () => {
					setMessage({ type: 'success', text: 'Broadcast rescinded.' })
					await refetch()
				}}
				onError={(error) => {
					setMessage({ type: 'error', text: error.message })
				}}
			/>
			<AddBroadcastAddendumDialog
				broadcastId={broadcast.id}
				open={addendumDialogOpen}
				onOpenChange={setAddendumDialogOpen}
				onSuccess={async () => {
					setMessage({ type: 'success', text: 'Broadcast addendum appended.' })
					await refetch()
				}}
				onError={(error) => {
					setMessage({ type: 'error', text: error.message })
				}}
			/>
		</div>
	)
}
