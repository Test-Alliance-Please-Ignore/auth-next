import { ArrowLeft, Ban, Edit3, FilePlus2, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { renderDiscordContentValue } from '@/components/discord-content-renderer'
import { AddBroadcastAddendumDialog } from './add-broadcast-addendum-dialog'
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
	useBroadcast,
	useBroadcastDeliveries,
	useBroadcastTargets,
	useDeleteBroadcast,
	useSendBroadcast,
} from '@/hooks/useBroadcasts'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { getBroadcastActionVisibility } from '@/lib/broadcast-permissions'
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

function isBlankValue(value: unknown): boolean {
	if (value === null || value === undefined) return true
	if (typeof value === 'string') return value.trim().length === 0
	if (Array.isArray(value)) return value.length === 0
	return false
}

function parseEnabledFlag(value: unknown): boolean {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase()
		return ['true', '1', 'yes', 'enabled', 'on'].includes(normalized)
	}
	return false
}

function getSendBlockingIssues(broadcast: {
	content: Record<string, unknown>
	template?: {
		fieldSchema: Array<{
			name: string
			label: string
			required?: boolean
		}>
	}
}): string[] {
	const issues: string[] = []
	const fieldSchema = broadcast.template?.fieldSchema ?? []

	for (const field of fieldSchema) {
		if (!field.required) continue
		const value = broadcast.content[field.name]
		if (isBlankValue(value)) {
			issues.push(`Required field missing: ${field.label || field.name}`)
		}
	}

	const fleetTrackingEnabled = parseEnabledFlag(broadcast.content.__fleetTrackingEnabled)
	if (fleetTrackingEnabled) {
		const trackingCharacterId = broadcast.content.__fleetTrackingCharacterId
		if (isBlankValue(trackingCharacterId)) {
			issues.push('Fleet tracking is enabled but no tracking character is selected.')
		}
	}

	return issues
}

export default function BroadcastDetailPage() {
	const navigate = useNavigate()
	const { broadcastId } = useParams<{ broadcastId: string }>()
	const { data: broadcast, isLoading, refetch } = useBroadcast(broadcastId || '')
	const { data: deliveries, isLoading: isLoadingDeliveries } = useBroadcastDeliveries(
		broadcastId || ''
	)
	const { data: targets } = useBroadcastTargets()
	const { user, permissions } = useAuth()
	const sendBroadcast = useSendBroadcast()
	const deleteBroadcast = useDeleteBroadcast()
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [rescindDialogOpen, setRescindDialogOpen] = useState(false)
	const [addendumDialogOpen, setAddendumDialogOpen] = useState(false)
	const [sendBlockedDialogOpen, setSendBlockedDialogOpen] = useState(false)
	const [sendBlockingIssues, setSendBlockingIssues] = useState<string[]>([])
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	usePageTitle(broadcast ? `Broadcast ${broadcast.id.slice(0, 8)}` : 'Broadcast Details')

	if (isLoading) {
		return (
			<Container>
				<div className="py-8 text-center text-muted-foreground">Loading broadcast details...</div>
			</Container>
		)
	}

	if (!broadcast) {
		return (
			<Container>
				<Card className="border-destructive bg-destructive/10">
					<CardContent className="py-8 text-center">
						<p className="text-destructive font-medium">Broadcast not found</p>
						<Button variant="ghost" className="mt-4" asChild>
							<Link to="/broadcasts">
								<ArrowLeft className="h-4 w-4" />
								Back to Broadcasts
							</Link>
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	const targetName =
		broadcast.target?.name ||
		targets?.find((target) => target.id === broadcast.targetId)?.name ||
		broadcast.targetId
	const canSend = true
	const { canDelete: canManage, canRescind } = getBroadcastActionVisibility({
		user,
		permissions,
		broadcast,
		target: broadcast.target,
	})
	const isSendable = canSend && ['draft', 'scheduled', 'failed'].includes(broadcast.status)
	const isEditable = broadcast.status === 'draft'

	const handleSendNow = async () => {
		const issues = getSendBlockingIssues(broadcast)
		if (issues.length > 0) {
			setSendBlockingIssues(issues)
			setSendBlockedDialogOpen(true)
			return
		}
		try {
			const sendResult = await sendBroadcast.mutateAsync(broadcast.id)
			if (sendResult.trackingSessionId) {
				setMessage({ type: 'success', text: 'Broadcast sent — opening tracking session…' })
				setTimeout(() => navigate(`/fleet-tracking/${sendResult.trackingSessionId}`), 1200)
				return
			}
			if (sendResult.trackingError) {
				setMessage({
					type: 'error',
					text: `Broadcast sent, but fleet tracking failed: ${sendResult.trackingError}`,
				})
				return
			}
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
			navigate('/broadcasts')
		} catch (error) {
			setDeleteDialogOpen(false)
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete broadcast',
			})
		}
	}

	return (
		<Container>
			<Section>
				<div className="space-y-6">
					<div className="flex items-center justify-between gap-3">
						<Button variant="ghost" size="sm" asChild>
							<Link to="/broadcasts">
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
							{canRescind && broadcast.status === 'sent' && (
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
							{canRescind && broadcast.status === 'sent' && (
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
							{canManage && (
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
							)}
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
								<div className="text-sm text-muted-foreground">Target</div>
								<div className="font-medium">{targetName}</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground">Template</div>
								<div className="font-medium">
									{broadcast.template?.name ||
										(broadcast.templateId ? broadcast.templateId : 'Custom')}
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
										<div className="text-xs uppercase tracking-wide text-muted-foreground">
											{key}
										</div>
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

					{canManage && (
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
					)}

					<RescindBroadcastDialog
						broadcast={broadcast}
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
						broadcast={broadcast}
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
					<Dialog open={sendBlockedDialogOpen} onOpenChange={setSendBlockedDialogOpen}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Broadcast Cannot Be Sent</DialogTitle>
								<DialogDescription>
									This broadcast is missing required data and would send incomplete content.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-2 text-sm">
								<div className="font-medium text-foreground">Missing items:</div>
								<ul className="list-disc pl-5 space-y-1 text-muted-foreground">
									{sendBlockingIssues.map((issue) => (
										<li key={issue}>{issue}</li>
									))}
								</ul>
							</div>
							<DialogFooter>
								<Button variant="cancel" onClick={() => setSendBlockedDialogOpen(false)}>
									Cancel
								</Button>
								<Button
									variant="confirm"
									onClick={() => {
										setSendBlockedDialogOpen(false)
										navigate(`/broadcasts/new?draftId=${broadcast.id}`)
									}}
								>
									Open for Editing
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>
			</Section>
		</Container>
	)
}
