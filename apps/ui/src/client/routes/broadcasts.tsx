import { Ban, ExternalLink, FilePlus2, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { DataTable } from '@/components/data-table'
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
import { BroadcastFeedback } from '@/features/broadcasts/components/broadcast-feedback'
import { BroadcastStatusBadge } from '@/features/broadcasts/components/broadcast-status-badge'
import { BroadcastTemplateShortcuts } from '@/features/broadcasts/components/broadcast-template-shortcuts'
import { useAuth } from '@/hooks/useAuth'
import {
	useBroadcasts,
	useBroadcastTargets,
	useBroadcastTemplates,
	useDeleteBroadcast,
	useSendBroadcast,
} from '@/hooks/useBroadcasts'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatNumber, useAppTranslation } from '@/i18n'
import { getBroadcastActionVisibility } from '@/lib/broadcast-permissions'
import { formatDateTime } from '@/lib/date-utils'
import toast from '@/lib/toast'

import { AddBroadcastAddendumDialog } from './add-broadcast-addendum-dialog'
import { RescindBroadcastDialog } from './rescind-broadcast-dialog'

import type { DataTableColumn } from '@/components/data-table'
import type { Broadcast } from '@/lib/api'

export default function BroadcastsPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('broadcasts.title'))
	const pageSize = 25
	const navigate = useNavigate()
	const [page, setPage] = useState(0)
	const { user, permissions } = useAuth()
	const {
		data: broadcastsPage,
		isLoading,
		error,
	} = useBroadcasts(undefined, undefined, {
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
	const [addendumDialogOpen, setAddendumDialogOpen] = useState(false)
	const [selectedBroadcast, setSelectedBroadcast] = useState<Broadcast | null>(null)

	const myBroadcasts = broadcastsPage?.rows ?? []
	const rowCount = broadcastsPage?.rowCount ?? 0
	const maxPage = Math.max(Math.ceil(rowCount / pageSize) - 1, 0)
	useEffect(() => {
		// A new page has no cached count while loading; clamp only against a received page.
		if (broadcastsPage && page > maxPage) setPage(maxPage)
	}, [broadcastsPage, page, maxPage])

	const handleSendNow = async (broadcast: Broadcast) => {
		if (sendBroadcast.isPending) return
		try {
			const result = await sendBroadcast.mutateAsync(broadcast.id)
			if (result.trackingError) {
				toast.error(
					<BroadcastFeedback
						messageKey="broadcasts.feedback.trackingFailed"
						error={result.trackingError}
					/>
				)
			} else {
				toast.success(<BroadcastFeedback messageKey="broadcasts.feedback.queued" />)
			}
		} catch (error) {
			toast.error(<BroadcastFeedback messageKey="broadcasts.feedback.sendFailed" error={error} />)
		}
	}
	const closeDelete = () => {
		if (deleteBroadcast.isPending) return
		setDeleteDialogOpen(false)
		setSelectedBroadcast(null)
		deleteBroadcast.reset()
	}
	const handleDeleteConfirm = async () => {
		if (!selectedBroadcast || deleteBroadcast.isPending) return
		try {
			await deleteBroadcast.mutateAsync(selectedBroadcast.id)
			setDeleteDialogOpen(false)
			setSelectedBroadcast(null)
			toast.success(<BroadcastFeedback messageKey="broadcasts.feedback.deleted" />)
		} catch {
			// The mutation error is rendered inside the confirmation so it can be retried.
		}
	}
	const columns: Array<DataTableColumn<Broadcast>> = [
		{
			id: 'status',
			header: t('broadcasts.statusLabel'),
			cell: (broadcast) => <BroadcastStatusBadge status={broadcast.status} />,
		},
		{
			id: 'target',
			header: t('broadcasts.target'),
			className: 'font-medium',
			cell: (broadcast) =>
				targets?.find((target) => target.id === broadcast.targetId)?.name || broadcast.targetId,
		},
		{
			id: 'template',
			header: t('broadcasts.template'),
			cell: (broadcast) =>
				templates?.find((template) => template.id === broadcast.templateId)?.name ||
				t('broadcasts.custom'),
		},
		{
			id: 'created',
			header: t('broadcasts.created'),
			className: 'text-sm text-muted-foreground',
			cell: (broadcast) => formatDateTime(broadcast.createdAt),
		},
		{
			id: 'scheduled',
			header: t('broadcasts.scheduled'),
			className: 'text-sm text-muted-foreground',
			cell: (broadcast) => (broadcast.scheduledFor ? formatDateTime(broadcast.scheduledFor) : '-'),
		},
		{
			id: 'actions',
			header: t('broadcasts.actions'),
			className: 'text-right',
			headerClassName: 'text-right',
			sticky: 'right',
			cell: (broadcast) => {
				const target = targets?.find((target) => target.id === broadcast.targetId)
				const { canDelete, canRescind } = getBroadcastActionVisibility({
					user,
					permissions,
					broadcast,
					target,
				})
				return (
					<div className="flex items-center justify-end gap-2">
						<Button
							asChild
							variant="ghost"
							size="icon"
							title={t('broadcasts.showDetails')}
							aria-label={t('broadcasts.showDetails')}
						>
							<Link to={`/broadcasts/${broadcast.id}`}>
								<ExternalLink className="h-4 w-4" />
							</Link>
						</Button>
						{canRescind && broadcast.status === 'sent' && (
							<Button
								variant="ghost"
								size="icon"
								onClick={() => {
									setSelectedBroadcast(broadcast)
									setAddendumDialogOpen(true)
								}}
								title={t('broadcasts.addendum.action')}
								aria-label={t('broadcasts.addendum.action')}
							>
								<FilePlus2 className="h-4 w-4 text-primary" />
							</Button>
						)}
						{broadcast.status === 'draft' && (
							<Button
								variant="ghost"
								size="icon"
								onClick={() => navigate(`/broadcasts/new?draftId=${broadcast.id}`)}
								title={t('broadcasts.editDraft')}
								aria-label={t('broadcasts.editDraft')}
							>
								<Pencil className="h-4 w-4" />
							</Button>
						)}
						{['draft', 'scheduled', 'failed'].includes(broadcast.status) && (
							<Button
								variant="ghost"
								size="icon"
								onClick={() => void handleSendNow(broadcast)}
								disabled={sendBroadcast.isPending}
								title={t('broadcasts.sendNow')}
								aria-label={t('broadcasts.sendNow')}
							>
								<Send className="h-4 w-4 text-confirm" />
							</Button>
						)}
						{canRescind && (
							<Button
								variant="ghost"
								size="icon"
								onClick={() => {
									setSelectedBroadcast(broadcast)
									setRescindDialogOpen(true)
								}}
								title={t('broadcasts.rescindAction')}
								aria-label={t('broadcasts.rescindAction')}
							>
								<Ban className="h-4 w-4 text-warning" />
							</Button>
						)}
						{canDelete && (
							<Button
								variant="ghost"
								size="icon"
								onClick={() => {
									deleteBroadcast.reset()
									setSelectedBroadcast(broadcast)
									setDeleteDialogOpen(true)
								}}
								disabled={deleteBroadcast.isPending}
								title={t('broadcasts.deleteAction')}
								aria-label={t('broadcasts.deleteAction')}
							>
								<Trash2 className="h-4 w-4 text-destructive" />
							</Button>
						)}
					</div>
				)
			},
		},
	]
	return (
		<Container>
			<PageHeader
				title={t('broadcasts.title')}
				description={t('broadcasts.description')}
				action={
					<Button onClick={() => navigate('/broadcasts/new')}>
						<Plus className="h-4 w-4" />
						{t('broadcasts.new')}
					</Button>
				}
			/>
			<Section>
				<div className="grid gap-4 md:grid-cols-4">
					{(
						[
							[t('broadcasts.total'), rowCount],
							[t('broadcasts.status.sent'), myBroadcasts.filter((b) => b.status === 'sent').length],
							[
								t('broadcasts.status.scheduled'),
								myBroadcasts.filter((b) => b.status === 'scheduled').length,
							],
							[
								t('broadcasts.status.failed'),
								myBroadcasts.filter((b) => b.status === 'failed').length,
							],
						] as const
					).map(([label, count]) => (
						<Card key={label} variant="elevated">
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">{label}</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{formatNumber(count)}</div>
							</CardContent>
						</Card>
					))}
				</div>
				<BroadcastTemplateShortcuts />
				{!isLoading && !error && rowCount === 0 ? (
					<Card variant="elevated">
						<CardContent className="py-16 text-center">
							<div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-6">
								<Plus className="h-10 w-10 text-muted-foreground" />
							</div>
							<h3 className="text-xl font-semibold mb-2">{t('broadcasts.emptyTitle')}</h3>
							<p className="text-muted-foreground mb-6 max-w-md mx-auto">
								{t('broadcasts.emptyDescription')}
							</p>
							<Button onClick={() => navigate('/broadcasts/new')} size="lg">
								<Plus className="h-4 w-4" />
								{t('broadcasts.createFirst')}
							</Button>
						</CardContent>
					</Card>
				) : (
					<Card variant="elevated">
						<CardHeader>
							<CardTitle>{t('broadcasts.recent')}</CardTitle>
							<CardDescription>{t('broadcasts.history')}</CardDescription>
						</CardHeader>
						<CardContent>
							<DataTable
								variant="plain"
								columns={columns}
								rows={myBroadcasts}
								getRowKey={(broadcast) => broadcast.id}
								loading={isLoading}
								error={error}
								errorMessage={t('broadcasts.loadFailed')}
								emptyMessage={t('broadcasts.emptyTitle')}
								rowCount={rowCount}
								itemLabel={t('broadcasts.item', { count: rowCount })}
								pagination={{ pageIndex: page, pageSize }}
								onPaginationChange={(next) => setPage(next.pageIndex)}
								pageSizeOptions={[pageSize]}
								paginationPosition="bottom"
							/>
						</CardContent>
					</Card>
				)}
			</Section>
			<Dialog
				open={deleteDialogOpen}
				onOpenChange={(open) => {
					if (!open) closeDelete()
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
						<Button variant="cancel" onClick={closeDelete} disabled={deleteBroadcast.isPending}>
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={() => void handleDeleteConfirm()}
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
			<RescindBroadcastDialog
				key={`rescind-${selectedBroadcast?.id}`}
				broadcastId={selectedBroadcast?.id ?? ''}
				open={rescindDialogOpen}
				onOpenChange={(open) => {
					setRescindDialogOpen(open)
					if (!open) setSelectedBroadcast(null)
				}}
			/>
			<AddBroadcastAddendumDialog
				key={`addendum-${selectedBroadcast?.id}`}
				broadcastId={selectedBroadcast?.id ?? ''}
				open={addendumDialogOpen}
				onOpenChange={(open) => {
					setAddendumDialogOpen(open)
					if (!open) setSelectedBroadcast(null)
				}}
			/>
		</Container>
	)
}
