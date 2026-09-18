import { FilePlus2, Loader2, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'

import {
	getPersonalBroadcastTemplateContent,
	MAX_PERSONAL_BROADCAST_TEMPLATES,
} from '@repo/broadcasts'

import { DataTable } from '@/components/data-table'
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
	useBroadcastTargets,
	useBroadcastTemplates,
	useCreateBroadcast,
	useDeletePersonalBroadcastTemplate,
	usePersonalBroadcastTemplates,
	useSendBroadcast,
} from '@/hooks/useBroadcasts'
import { useAppTranslation } from '@/i18n'

import { canUseTemplateForTarget } from '../template-shortcuts'
import { BroadcastFeedback } from './broadcast-feedback'

import type { PersonalBroadcastTemplate } from '@repo/broadcasts'
import type { DataTableColumn } from '@/components/data-table'
import type { AppTranslationKey } from '@/i18n'
import type { BroadcastTarget, BroadcastTemplate } from '@/lib/api'

export function BroadcastTemplateShortcuts() {
	const { t } = useAppTranslation()
	const targets = useBroadcastTargets()
	const templates = useBroadcastTemplates()
	const personalTemplates = usePersonalBroadcastTemplates()
	const remove = useDeletePersonalBroadcastTemplate()
	const createBroadcast = useCreateBroadcast()
	const sendBroadcast = useSendBroadcast()
	const sendingRef = useRef(false)
	const [sendingId, setSendingId] = useState<string | null>(null)
	const [sendFeedback, setSendFeedback] = useState<{
		type: 'success' | 'error'
		messageKey: AppTranslationKey
		error?: unknown
		broadcastId?: string
	} | null>(null)
	const [deleting, setDeleting] = useState<PersonalBroadcastTemplate | null>(null)
	const handleSendNow = async (
		personal: PersonalBroadcastTemplate,
		target: BroadcastTarget,
		template?: BroadcastTemplate
	) => {
		if (sendingRef.current) return
		const content = template
			? getPersonalBroadcastTemplateContent(
					personal.content,
					template.fieldSchema.map((field) => field.name)
				)
			: {
					message: personal.content.message ?? '',
					mentionLevel: personal.content.mentionLevel ?? 'here',
				}
		const incomplete = template
			? template.fieldSchema.some((field) => field.required && !content[field.name]?.trim())
			: !content.message?.trim()
		if (incomplete) {
			setSendFeedback({ type: 'error', messageKey: 'broadcasts.personal.incomplete' })
			return
		}
		// Guard immediately, including the gap between creation and delivery, so
		// rapid clicks cannot create multiple broadcasts before React rerenders.
		sendingRef.current = true
		setSendingId(personal.id)
		setSendFeedback(null)
		let broadcastId: string | undefined
		try {
			// Stored values never include a previous SRP token or delivery metadata.
			// The existing send API generates a fresh token, footer and tracking session.
			const broadcast = await createBroadcast.mutateAsync({
				targetId: target.id,
				templateId: personal.templateId ?? undefined,
				title: `Broadcast to ${target.name}`,
				content,
			})
			broadcastId = broadcast.id
			const result = await sendBroadcast.mutateAsync(broadcastId)
			if (!result.success) {
				setSendFeedback({
					type: 'error',
					messageKey: 'broadcasts.feedback.sendFailed',
					error: result.delivery.errorMessage ? new Error(result.delivery.errorMessage) : undefined,
					broadcastId,
				})
			} else if (result.trackingError) {
				setSendFeedback({
					type: 'error',
					messageKey: 'broadcasts.feedback.trackingFailed',
					error: result.trackingError,
					broadcastId,
				})
			} else {
				setSendFeedback({ type: 'success', messageKey: 'broadcasts.composer.sent', broadcastId })
			}
		} catch (error) {
			// Keep the new broadcast available for inspection; never retry delivery automatically.
			setSendFeedback({
				type: 'error',
				messageKey: 'broadcasts.feedback.sendFailed',
				error,
				broadcastId,
			})
		} finally {
			sendingRef.current = false
			setSendingId(null)
		}
	}
	const rows = (personalTemplates.data ?? []).map((personal) => {
		const target = targets.data?.find((item) => item.id === personal.targetId)
		const template = templates.data?.find((item) => item.id === personal.templateId)
		const usable = Boolean(
			target && (!personal.templateId || (template && canUseTemplateForTarget(template, target)))
		)
		return {
			personal,
			target,
			template,
			usable,
			href: `/broadcasts/new?${new URLSearchParams({ personalTemplateId: personal.id })}`,
			editHref: `/broadcasts/new?${new URLSearchParams({ personalTemplateId: personal.id, editTemplate: 'true' })}`,
		}
	})
	const failed = targets.isError || templates.isError || personalTemplates.isError
	const loading = targets.isPending || templates.isPending || personalTemplates.isPending
	const count = personalTemplates.data?.length ?? 0
	const columns: Array<DataTableColumn<(typeof rows)[number]>> = [
		{
			id: 'name',
			header: t('broadcasts.personal.name'),
			className: 'px-2 sm:px-4',
			headerClassName: 'px-2 sm:px-4',
			cell: ({ personal, target, usable, href }) => (
				<div className="max-w-20 whitespace-normal break-words sm:max-w-48">
					{usable ? (
						<Link
							to={href}
							className="rounded-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-label={t('broadcasts.templates.useLabel', {
								template: personal.name,
								target: target!.name,
							})}
						>
							{personal.name}
						</Link>
					) : (
						<span className="font-semibold">{personal.name}</span>
					)}
					<span className="mt-1 block text-xs text-muted-foreground sm:hidden">
						{target?.name ?? t('broadcasts.personal.targetUnavailable')}
					</span>
					{!usable && (
						<span className="mt-1 block text-xs text-muted-foreground">
							{t('broadcasts.personal.unavailable')}
						</span>
					)}
				</div>
			),
		},
		{
			id: 'target',
			header: t('broadcasts.target'),
			className: 'hidden sm:table-cell',
			headerClassName: 'hidden sm:table-cell',
			cell: ({ target }) => target?.name ?? t('broadcasts.personal.targetUnavailable'),
		},
		{
			id: 'template',
			header: t('broadcasts.template'),
			className: 'hidden max-w-xs whitespace-normal text-muted-foreground md:table-cell',
			headerClassName: 'hidden md:table-cell',
			cell: ({ personal, template }) =>
				personal.templateId
					? (template?.name ?? t('broadcasts.personal.unavailable'))
					: t('broadcasts.custom'),
		},
		{
			id: 'actions',
			header: t('broadcasts.actions'),
			className: 'px-2 text-right sm:px-4',
			headerClassName: 'px-2 text-right sm:px-4',
			cell: ({ personal, target, template, usable, href, editHref }) => (
				<div className="flex items-center justify-end gap-1 sm:gap-2">
					{usable && (
						<Button asChild variant="secondary" size="icon" className="h-9 w-9 sm:h-10 sm:w-10">
							<Link
								to={href}
								title={t('broadcasts.templates.use')}
								aria-label={t('broadcasts.templates.useLabel', {
									template: personal.name,
									target: target!.name,
								})}
							>
								<FilePlus2 aria-hidden className="h-4 w-4" />
							</Link>
						</Button>
					)}
					{usable && (
						<Button
							type="button"
							variant="success"
							size="icon"
							showIcon={false}
							className="h-9 w-9 sm:h-10 sm:w-10"
							disabled={sendingId !== null}
							aria-busy={sendingId === personal.id}
							aria-label={t('broadcasts.personal.sendLabel', {
								name: personal.name,
								target: target!.name,
							})}
							title={t('broadcasts.personal.sendLabel', {
								name: personal.name,
								target: target!.name,
							})}
							onClick={() => void handleSendNow(personal, target!, template)}
						>
							{sendingId === personal.id ? (
								<Loader2 aria-hidden className="h-4 w-4 animate-spin" />
							) : (
								<Send aria-hidden className="h-4 w-4" />
							)}
						</Button>
					)}
					{usable && (
						<Button asChild variant="ghost" size="icon" className="h-9 w-9 sm:h-10 sm:w-10">
							<Link
								to={editHref}
								aria-label={t('broadcasts.personal.editLabel', { name: personal.name })}
								title={t('broadcasts.personal.editLabel', { name: personal.name })}
							>
								<Pencil aria-hidden className="h-4 w-4" />
							</Link>
						</Button>
					)}
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-9 w-9 sm:h-10 sm:w-10"
						disabled={sendingId === personal.id}
						aria-label={t('broadcasts.personal.deleteLabel', { name: personal.name })}
						title={t('broadcasts.personal.deleteLabel', { name: personal.name })}
						onClick={() => {
							remove.reset()
							setDeleting(personal)
						}}
					>
						<Trash2 aria-hidden className="h-4 w-4 text-destructive" />
					</Button>
				</div>
			),
		},
	]
	return (
		<Card variant="elevated" className="min-w-0">
			<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="space-y-1">
					<CardTitle>{t('broadcasts.templates.title')}</CardTitle>
					<CardDescription>
						{t('broadcasts.personal.count', { count, max: MAX_PERSONAL_BROADCAST_TEMPLATES })}
					</CardDescription>
				</div>
				{!loading && !failed && count < MAX_PERSONAL_BROADCAST_TEMPLATES && (
					<Button asChild size="sm" variant="secondary">
						<Link to="/broadcasts/new">
							<Plus aria-hidden className="h-4 w-4" />
							{t('broadcasts.personal.new')}
						</Link>
					</Button>
				)}
			</CardHeader>
			<CardContent>
				{sendFeedback && (
					<p
						role={sendFeedback.type === 'error' ? 'alert' : 'status'}
						className={`mb-3 text-sm ${sendFeedback.type === 'error' ? 'text-destructive' : 'text-primary'}`}
					>
						<BroadcastFeedback messageKey={sendFeedback.messageKey} error={sendFeedback.error} />{' '}
						{sendFeedback.broadcastId && (
							<Link className="underline" to={`/broadcasts/${sendFeedback.broadcastId}`}>
								{t('broadcasts.showDetails')}
							</Link>
						)}
					</p>
				)}
				{failed ? (
					<div className="space-y-3">
						<p role="alert" className="text-sm text-destructive">
							{t('broadcasts.templates.loadFailed')}
						</p>
						<Button
							variant="secondary"
							size="sm"
							disabled={targets.isFetching || templates.isFetching || personalTemplates.isFetching}
							onClick={() => {
								void targets.refetch()
								void templates.refetch()
								void personalTemplates.refetch()
							}}
						>
							{t('broadcasts.templates.retry')}
						</Button>
					</div>
				) : loading ? (
					<p role="status" className="py-6 text-sm text-muted-foreground">
						{t('broadcasts.templates.loading')}
					</p>
				) : (
					<DataTable
						variant="plain"
						columns={columns}
						rows={rows}
						getRowKey={({ personal }) => personal.id}
						emptyMessage={t('broadcasts.personal.empty')}
					/>
				)}
			</CardContent>
			<Dialog
				open={Boolean(deleting)}
				onOpenChange={(open) => {
					if (!open && !remove.isPending) setDeleting(null)
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('broadcasts.personal.deleteTitle')}</DialogTitle>
						<DialogDescription>
							{t('broadcasts.personal.deleteDescription', { name: deleting?.name ?? '' })}
						</DialogDescription>
					</DialogHeader>
					{remove.isError && (
						<p role="alert" className="text-sm text-destructive">
							{t('broadcasts.personal.deleteFailed')}
						</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="cancel"
							disabled={remove.isPending}
							onClick={() => setDeleting(null)}
						>
							{t('common.cancel')}
						</Button>
						<Button
							type="button"
							variant="destructive"
							disabled={remove.isPending}
							onClick={async () => {
								if (!deleting || remove.isPending) return
								try {
									await remove.mutateAsync(deleting.id)
									setDeleting(null)
								} catch {
									/* Keep the confirmation open for retry. */
								}
							}}
						>
							{t('common.delete')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	)
}
