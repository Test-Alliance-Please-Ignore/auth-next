import { ArrowLeft, Ban, Edit3, FilePlus2, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { DataTable } from '@/components/data-table'
import { renderDiscordContentValue } from '@/components/discord-content-renderer'
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
import { BroadcastFeedback } from '@/features/broadcasts/components/broadcast-feedback'
import { BroadcastStatusBadge } from '@/features/broadcasts/components/broadcast-status-badge'
import { useAuth } from '@/hooks/useAuth'
import {
	useBroadcast,
	useBroadcastDeliveries,
	useBroadcastTargets,
	useDeleteBroadcast,
	useSendBroadcast,
} from '@/hooks/useBroadcasts'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { NotFoundError } from '@/lib/api'
import { getBroadcastActionVisibility } from '@/lib/broadcast-permissions'
import { formatDateTimeLocal } from '@/lib/discord-time'

import { AddBroadcastAddendumDialog } from './add-broadcast-addendum-dialog'
import { RescindBroadcastDialog } from './rescind-broadcast-dialog'

import type { DataTableColumn } from '@/components/data-table'
import type { MessageText } from '@/hooks/useMessage'
import type { AppTranslationKey } from '@/i18n'
import type { BroadcastDelivery } from '@/lib/api'

type SendBlockingIssue = { key: AppTranslationKey; field?: string }

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
}): SendBlockingIssue[] {
	const issues: SendBlockingIssue[] = []
	const fieldSchema = broadcast.template?.fieldSchema ?? []

	for (const field of fieldSchema) {
		if (!field.required) continue
		const value = broadcast.content[field.name]
		if (isBlankValue(value)) {
			issues.push({ key: 'broadcasts.blocked.requiredField', field: field.label || field.name })
		}
	}

	const fleetTrackingEnabled = parseEnabledFlag(broadcast.content.__fleetTrackingEnabled)
	if (fleetTrackingEnabled) {
		const trackingCharacterId = broadcast.content.__fleetTrackingCharacterId
		if (isBlankValue(trackingCharacterId)) {
			issues.push({ key: 'broadcasts.blocked.trackingCharacter' })
		}
	}

	return issues
}

export default function BroadcastDetailPage() {
	const { t } = useAppTranslation()
	const navigate = useNavigate()
	const { broadcastId } = useParams<{ broadcastId: string }>()
	const { data: broadcast, isLoading, error, refetch } = useBroadcast(broadcastId || '')
	const {
		data: deliveries,
		isLoading: isLoadingDeliveries,
		error: deliveriesError,
	} = useBroadcastDeliveries(broadcastId || '')
	const { data: targets } = useBroadcastTargets()
	const { user, permissions } = useAuth()
	const sendBroadcast = useSendBroadcast()
	const deleteBroadcast = useDeleteBroadcast()
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [rescindDialogOpen, setRescindDialogOpen] = useState(false)
	const [addendumDialogOpen, setAddendumDialogOpen] = useState(false)
	const [sendBlockedDialogOpen, setSendBlockedDialogOpen] = useState(false)
	const [sendBlockingIssues, setSendBlockingIssues] = useState<SendBlockingIssue[]>([])
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: MessageText } | null>(
		null
	)

	usePageTitle(
		broadcast
			? t('broadcasts.detail.pageTitle', { id: broadcast.id.slice(0, 8) })
			: t('broadcasts.detail.title')
	)
	const trackingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	useEffect(
		() => () => {
			if (trackingTimer.current) clearTimeout(trackingTimer.current)
		},
		[]
	)

	if (isLoading) {
		return (
			<Container>
				<div className="py-8 text-center text-muted-foreground">
					{t('broadcasts.detail.loading')}
				</div>
			</Container>
		)
	}

	if (!broadcast) {
		return (
			<Container>
				<Card className="border-destructive bg-destructive/10">
					<CardContent className="py-8 text-center">
						<p role="alert" className="text-destructive font-medium">
							{error && !(error instanceof NotFoundError) ? (
								<BroadcastFeedback messageKey="broadcasts.detail.loadFailed" error={error} />
							) : (
								t('broadcasts.detail.notFound')
							)}
						</p>
						<Button variant="ghost" className="mt-4" asChild>
							<Link to="/broadcasts">
								<ArrowLeft className="h-4 w-4" />
								{t('broadcasts.detail.back')}
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
		if (sendBroadcast.isPending || !isSendable) return
		const issues = getSendBlockingIssues(broadcast)
		if (issues.length > 0) {
			setSendBlockingIssues(issues)
			setSendBlockedDialogOpen(true)
			return
		}
		try {
			const sendResult = await sendBroadcast.mutateAsync(broadcast.id)
			if (sendResult.trackingSessionId) {
				setMessage({ type: 'success', text: (t) => t('broadcasts.feedback.tracking') })
				trackingTimer.current = setTimeout(
					() => navigate(`/fleet-tracking/${sendResult.trackingSessionId}`),
					1200
				)
				return
			}
			if (sendResult.trackingError) {
				setMessage({
					type: 'error',
					text: (t) => t('broadcasts.feedback.trackingFailed', { error: sendResult.trackingError }),
				})
				return
			}
			setMessage({ type: 'success', text: (t) => t('broadcasts.feedback.queued') })
			await refetch()
		} catch (error) {
			setMessage({
				type: 'error',
				text:
					error instanceof Error && error.message
						? error.message
						: (t) => t('broadcasts.feedback.sendFailed'),
			})
		}
	}

	const handleDelete = async () => {
		if (deleteBroadcast.isPending || !canManage) return
		try {
			await deleteBroadcast.mutateAsync(broadcast.id)
			void navigate('/broadcasts')
		} catch {
			// Keep the confirmation open; its mutation error is shown below for retry.
		}
	}
	const deliveryColumns: Array<DataTableColumn<BroadcastDelivery>> = [
		{
			id: 'status',
			header: t('broadcasts.statusLabel'),
			cell: (delivery) => <BroadcastStatusBadge status={delivery.status} />,
		},
		{
			id: 'target',
			header: t('broadcasts.target'),
			cell: (delivery) =>
				delivery.target?.name ||
				targets?.find((target) => target.id === delivery.targetId)?.name ||
				delivery.targetId,
		},
		{
			id: 'sent',
			header: t('broadcasts.sent'),
			cell: (delivery) => formatDateTimeLocal(delivery.sentAt),
		},
		{
			id: 'error',
			header: t('broadcasts.detail.error'),
			className: 'text-sm text-muted-foreground',
			cell: (delivery) => delivery.errorMessage || '-',
		},
	]

	return (
		<Container>
			<Section>
				<div className="space-y-6">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Button variant="ghost" size="sm" asChild>
							<Link to="/broadcasts">
								<ArrowLeft className="h-4 w-4" />
								{t('broadcasts.detail.back')}
							</Link>
						</Button>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => refetch()}
								disabled={isLoading || sendBroadcast.isPending || deleteBroadcast.isPending}
								title={t('broadcasts.refresh')}
								aria-label={t('broadcasts.refresh')}
							>
								<RefreshCw className="h-4 w-4" />
							</Button>
							{isSendable && (
								<Button
									variant="confirm"
									size="sm"
									onClick={handleSendNow}
									loading={sendBroadcast.isPending}
									loadingText={t('broadcasts.sending')}
									showIcon={false}
								>
									<Send className="h-4 w-4" />
									{t('broadcasts.sendNow')}
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
									{t('broadcasts.editDraft')}
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
									{t('broadcasts.addendum.action')}
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
									{t('broadcasts.rescind.action')}
								</Button>
							)}
							{canManage && (
								<Button
									variant="destructive"
									size="sm"
									onClick={() => {
										deleteBroadcast.reset()
										setDeleteDialogOpen(true)
									}}
									disabled={deleteBroadcast.isPending}
									showIcon={false}
								>
									<Trash2 className="h-4 w-4" />
									{t('common.delete')}
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
								<p
									role={message.type === 'error' ? 'alert' : 'status'}
									className={message.type === 'error' ? 'text-destructive' : 'text-primary'}
								>
									{typeof message.text === 'function' ? message.text(t) : message.text}
								</p>
							</CardContent>
						</Card>
					)}

					<Card variant="elevated">
						<CardHeader>
							<div className="flex flex-wrap items-center justify-between gap-4">
								<div>
									<CardTitle>{t('broadcasts.detail.title')}</CardTitle>
									<CardDescription className="break-all">
										{t('broadcasts.detail.id', { id: broadcast.id })}
									</CardDescription>
								</div>
								<BroadcastStatusBadge status={broadcast.status} />
							</div>
						</CardHeader>
						<CardContent className="grid gap-4 md:grid-cols-2">
							<div>
								<div className="text-sm text-muted-foreground">{t('broadcasts.detail.name')}</div>
								<div className="font-medium break-words">{broadcast.title}</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground">{t('broadcasts.target')}</div>
								<div className="font-medium break-words">{targetName}</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground">{t('broadcasts.template')}</div>
								<div className="font-medium break-words">
									{broadcast.template?.name ||
										(broadcast.templateId ? broadcast.templateId : t('broadcasts.custom'))}
								</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground">{t('broadcasts.created')}</div>
								<div className="font-medium break-words">
									{formatDateTimeLocal(broadcast.createdAt)}
								</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground">{t('broadcasts.scheduled')}</div>
								<div className="font-medium break-words">
									{formatDateTimeLocal(broadcast.scheduledFor)}
								</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground">{t('broadcasts.sent')}</div>
								<div className="font-medium break-words">
									{formatDateTimeLocal(broadcast.sentAt)}
								</div>
							</div>
						</CardContent>
					</Card>

					<Card variant="elevated">
						<CardHeader>
							<CardTitle>{t('broadcasts.detail.content')}</CardTitle>
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
							<CardTitle>{t('broadcasts.detail.deliveries')}</CardTitle>
							<CardDescription>{t('broadcasts.detail.deliveriesDescription')}</CardDescription>
						</CardHeader>
						<CardContent>
							<DataTable
								variant="plain"
								columns={deliveryColumns}
								rows={deliveries ?? []}
								getRowKey={(delivery) => delivery.id}
								loading={isLoadingDeliveries}
								error={deliveriesError}
								errorMessage={t('broadcasts.detail.deliveriesFailed')}
								emptyMessage={t('broadcasts.detail.noDeliveries')}
							/>
						</CardContent>
					</Card>

					{canManage && (
						<Dialog
							open={deleteDialogOpen}
							onOpenChange={(open) => {
								if (!deleteBroadcast.isPending) setDeleteDialogOpen(open)
							}}
						>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>{t('broadcasts.deleteTitle')}</DialogTitle>
									<DialogDescription>{t('broadcasts.deleteDescription')}</DialogDescription>
								</DialogHeader>
								{deleteBroadcast.isError && (
									<p role="alert" className="text-sm text-destructive">
										<BroadcastFeedback
											messageKey="broadcasts.feedback.deleteFailed"
											error={deleteBroadcast.error}
										/>
									</p>
								)}
								<DialogFooter>
									<Button
										variant="cancel"
										disabled={deleteBroadcast.isPending}
										onClick={() => setDeleteDialogOpen(false)}
									>
										{t('common.cancel')}
									</Button>
									<Button
										variant="destructive"
										onClick={handleDelete}
										loading={deleteBroadcast.isPending}
										loadingText={t('broadcasts.deleting')}
										showIcon={false}
									>
										<Trash2 className="h-4 w-4" />
										{t('common.delete')}
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
							setMessage({ type: 'success', text: (t) => t('broadcasts.feedback.rescinded') })
							await refetch()
						}}
					/>
					<AddBroadcastAddendumDialog
						broadcast={broadcast}
						broadcastId={broadcast.id}
						open={addendumDialogOpen}
						onOpenChange={setAddendumDialogOpen}
						onSuccess={async () => {
							setMessage({ type: 'success', text: (t) => t('broadcasts.feedback.added') })
							await refetch()
						}}
					/>
					<Dialog open={sendBlockedDialogOpen} onOpenChange={setSendBlockedDialogOpen}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>{t('broadcasts.blocked.title')}</DialogTitle>
								<DialogDescription>{t('broadcasts.blocked.description')}</DialogDescription>
							</DialogHeader>
							<div className="space-y-2 text-sm">
								<div className="font-medium text-foreground">{t('broadcasts.blocked.items')}</div>
								<ul className="list-disc pl-5 space-y-1 text-muted-foreground">
									{sendBlockingIssues.map((issue, index) => (
										<li key={index}>{t(issue.key, { field: issue.field })}</li>
									))}
								</ul>
							</div>
							<DialogFooter>
								<Button variant="cancel" onClick={() => setSendBlockedDialogOpen(false)}>
									{t('common.cancel')}
								</Button>
								<Button
									variant="confirm"
									onClick={() => {
										setSendBlockedDialogOpen(false)
										void navigate(`/broadcasts/new?draftId=${broadcast.id}`)
									}}
								>
									{t('broadcasts.blocked.edit')}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>
			</Section>
		</Container>
	)
}
