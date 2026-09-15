import { Link2, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'

import { parseDateOrNull } from '@repo/worker-utils'

import { DataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { formatNumber, useAppTranslation } from '@/i18n'
import { formatDateTime } from '@/lib/date-utils'
import toast from '@/lib/toast'

import { useCreateTempop, useDeleteTempop, useTempops } from '../tempop-hooks'
import { CopyRow } from './credentials-card'
import { MumbleFeedback } from './feedback'

import type { DataTableColumn } from '@/components/data-table'
import type { AppTranslationKey, AppTranslator } from '@/i18n'
import type { CreateTempopResponse, TempopListFilters, TempopListItem } from '@/lib/api'

const ALL_CREATORS = '__all__'

const STATUS_KEYS: Record<StatusFilter, AppTranslationKey> = {
	active: 'mumble.tempop.status.active',
	expired: 'mumble.tempop.status.expired',
	deleted: 'mumble.tempop.status.deleted',
	all: 'mumble.tempop.status.all',
}
type StatusFilter = 'active' | 'expired' | 'deleted' | 'all'
function statusLabel(t: AppTranslator, status: string) {
	return t(
		Object.hasOwn(STATUS_KEYS, status)
			? STATUS_KEYS[status as StatusFilter]
			: 'mumble.tempop.status.unknown'
	)
}
function formatExpiry(item: TempopListItem, t: AppTranslator): string {
	if (item.status === 'deleted') return t('mumble.tempop.status.deleted')
	const expiresAt = parseDateOrNull(item.expiresAt)
	if (!expiresAt) return t('common.notAvailable')
	const remainingMs = expiresAt.getTime() - Date.now()
	if (item.status === 'expired' || remainingMs <= 0) return t('mumble.tempop.status.expired')
	const totalMinutes = Math.floor(remainingMs / 60000)
	const hours = Math.floor(totalMinutes / 60)
	const minutes = totalMinutes % 60
	return t(hours > 0 ? 'mumble.tempop.remainingHours' : 'mumble.tempop.remainingMinutes', {
		hours: formatNumber(hours),
		minutes: formatNumber(minutes),
	})
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' {
	if (status === 'active') return 'default'
	if (status === 'deleted') return 'destructive'
	return 'secondary'
}

/** Permission-gated create card. */
function CreateTempopCard() {
	const { t } = useAppTranslation()
	const create = useCreateTempop()
	const [ttlMode, setTtlMode] = useState('1h')
	const [customHours, setCustomHours] = useState('2')
	const [generated, setGenerated] = useState<(CreateTempopResponse & { url: string }) | null>(null)

	const customHoursNumber = Number(customHours)
	const customInvalid =
		ttlMode === 'custom' &&
		(!Number.isFinite(customHoursNumber) || customHoursNumber <= 0 || customHoursNumber > 12)

	const handleGenerate = () => {
		if (create.isPending || customInvalid) return
		const input =
			ttlMode === 'custom'
				? { customHours: customHoursNumber }
				: { ttlPreset: ttlMode as '1h' | '4h' | '6h' }
		create.mutate(input, {
			onSuccess: (res) => {
				setGenerated({ ...res, url: `${window.location.origin}/tempop/${res.token}` })
			},
			onError: (error) => {
				toast.error(
					error instanceof Error && error.message ? (
						error.message
					) : (
						<MumbleFeedback messageKey="mumble.feedback.createFailed" />
					)
				)
			},
		})
	}

	return (
		<Card variant="default">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Link2 className="h-5 w-5" />
					{t('mumble.tempop.createTitle')}
				</CardTitle>
				<CardDescription>
					{t('mumble.tempop.createDescription', { group: 'TempOp' })}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-end gap-3">
					<div className="space-y-1">
						<Label htmlFor="tempop-ttl">{t('mumble.tempop.duration')}</Label>
						<Select
							inputId="tempop-ttl"
							disabled={create.isPending}
							options={[
								...[1, 4, 6].map((hours) => ({
									value: `${hours}h`,
									label: t('mumble.tempop.hours', {
										count: hours,
										formattedCount: formatNumber(hours),
									}),
								})),
								{ value: 'custom', label: t('mumble.tempop.custom') },
							]}
							value={ttlMode}
							onValueChange={(value) => setTtlMode(value)}
							className="w-40"
						/>
					</div>
					{ttlMode === 'custom' ? (
						<div className="space-y-1">
							<Label htmlFor="tempop-custom-hours">{t('mumble.tempop.customHours')}</Label>
							<Input
								id="tempop-custom-hours"
								type="number"
								min={0}
								step="any"
								disabled={create.isPending}
								max={12}
								value={customHours}
								onChange={(e) => setCustomHours(e.target.value)}
								className="w-28"
							/>
						</div>
					) : null}
					<Button onClick={handleGenerate} disabled={create.isPending || customInvalid}>
						{create.isPending ? t('mumble.generating') : t('mumble.tempop.generate')}
					</Button>
				</div>

				{customInvalid ? (
					<p role="alert" className="text-sm text-destructive">
						{t('mumble.tempop.invalidDuration')}
					</p>
				) : null}

				{generated ? (
					<div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
						<p className="text-sm">
							{t('mumble.tempop.share', {
								code: generated.shortCode,
								time: formatDateTime(generated.expiresAt),
							})}
						</p>
						<CopyRow labelKey="mumble.credentials.link" value={generated.url} />
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}

/** Keep each row's deletion target stable while its confirmation is open. */
function TempopDeleteAction({ item }: { item: TempopListItem }) {
	const { t } = useAppTranslation()
	const del = useDeleteTempop()
	const [confirmOpen, setConfirmOpen] = useState(false)
	const handleDelete = () => {
		if (del.isPending || !item.canDelete || item.status === 'deleted') return
		del.mutate(item.id, {
			onSuccess: (result) => {
				toast.success(
					<MumbleFeedback
						messageKey={
							result.disconnected > 0 ? 'mumble.feedback.disconnected' : 'mumble.feedback.deleted'
						}
						count={result.disconnected}
					/>
				)
				setConfirmOpen(false)
			},
			onError: (error) =>
				toast.error(
					error instanceof Error && error.message ? (
						error.message
					) : (
						<MumbleFeedback messageKey="mumble.feedback.deleteFailed" />
					)
				),
		})
	}
	if (!item.canDelete || item.status === 'deleted')
		return <span className="text-sm text-muted-foreground">—</span>
	return (
		<>
			<Button
				variant="destructive"
				size="sm"
				onClick={() => setConfirmOpen(true)}
				disabled={del.isPending}
			>
				<Trash2 className="mr-1 h-4 w-4" />
				{t('common.delete')}
			</Button>
			<ConfirmationDialog
				open={confirmOpen}
				title={t('mumble.tempop.deleteTitle')}
				description={t('mumble.tempop.deleteDescription')}
				confirmLabel={t('common.delete')}
				pending={del.isPending}
				onCancel={() => {
					if (!del.isPending) setConfirmOpen(false)
				}}
				onConfirm={handleDelete}
			/>
		</>
	)
}

/**
 * Temp-op management section: a permission-gated create card plus a filtered
 * list. `canCreate` controls the create card; `canManageAll` (admin or
 * delete-any) unlocks the creator filter and cross-creator listing.
 */
export function TempopSection({
	canCreate,
	canManageAll,
}: {
	canCreate: boolean
	canManageAll: boolean
}) {
	const { t } = useAppTranslation()
	const [status, setStatus] = useState<StatusFilter>('active')
	const [creatorId, setCreatorId] = useState('')
	const [mine, setMine] = useState(false)
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)

	const filters: TempopListFilters = useMemo(
		() => ({
			status,
			...(canManageAll && !mine && creatorId ? { creatorId } : {}),
			...(mine ? { mine: true } : {}),
			page,
			pageSize,
		}),
		[status, creatorId, mine, canManageAll, page, pageSize]
	)

	const { data, isLoading, error } = useTempops(filters)
	const totalCount = data?.pagination.totalCount ?? 0
	const totalPages = data?.pagination.totalPages ?? 0
	const hasPagination = totalPages > 1

	const creatorOptions = useMemo(
		() => [
			{ value: ALL_CREATORS, label: t('mumble.tempop.allCreators') },
			...(data?.creators ?? []).map((creator) => ({
				value: creator.id,
				label: creator.name ?? creator.id,
			})),
		],
		[data?.creators, t]
	)

	const columns: Array<DataTableColumn<TempopListItem>> = [
		{
			id: 'code',
			header: t('mumble.tempop.code'),
			className: 'font-mono font-medium',
			cell: (item) => item.shortCode,
		},
		{
			id: 'creator',
			header: t('mumble.tempop.creator'),
			cell: (item) => item.creatorName ?? t('mumble.tempop.unknownCreator'),
		},
		{ id: 'group', header: t('mumble.tempop.group'), cell: (item) => item.groupName },
		{
			id: 'status',
			header: t('mumble.tempop.statusLabel'),
			cell: (item) => (
				<Badge variant={statusBadgeVariant(item.status)}>{statusLabel(t, item.status)}</Badge>
			),
		},
		{
			id: 'guests',
			header: t('mumble.tempop.guests'),
			cell: (item) => (
				<span className="flex items-center gap-1">
					<Users className="h-4 w-4 text-muted-foreground" />
					{formatNumber(item.guestCount)}
				</span>
			),
		},
		{ id: 'expires', header: t('mumble.tempop.expires'), cell: (item) => formatExpiry(item, t) },
		{
			id: 'actions',
			header: t('mumble.tempop.actions'),
			className: 'text-right',
			headerClassName: 'text-right',
			cell: (item) => <TempopDeleteAction item={item} />,
		},
	]

	const resetPage = () => setPage(1)

	return (
		<div className="space-y-4">
			{canCreate ? <CreateTempopCard /> : null}

			<Card variant="default">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-sm font-medium">
						<Link2 className="h-4 w-4" />
						{t('mumble.tempop.title')}
					</CardTitle>
					<CardDescription>{t('mumble.tempop.description')}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex flex-wrap items-end gap-3">
						<div className="space-y-1">
							<Label htmlFor="tempop-status">{t('mumble.tempop.statusLabel')}</Label>
							<Select
								inputId="tempop-status"
								options={(['active', 'expired', 'deleted', 'all'] as const).map((value) => ({
									value,
									label: statusLabel(t, value),
								}))}
								value={status}
								onValueChange={(value) => {
									setStatus(value as StatusFilter)
									resetPage()
								}}
								className="w-36"
							/>
						</div>
						{canManageAll ? (
							<div className="space-y-1">
								<Label htmlFor="tempop-creator">{t('mumble.tempop.creator')}</Label>
								<Select
									inputId="tempop-creator"
									options={creatorOptions}
									value={creatorId === '' ? ALL_CREATORS : creatorId}
									onValueChange={(value) => {
										setCreatorId(value === ALL_CREATORS ? '' : value)
										resetPage()
									}}
									disabled={mine}
									className="w-56"
								/>
							</div>
						) : null}
						{canManageAll ? (
							<Button
								variant={mine ? 'primary' : 'secondary'}
								aria-pressed={mine}
								onClick={() => {
									setMine((v) => !v)
									resetPage()
								}}
							>
								{t('mumble.tempop.mine')}
								{mine ? ' ✓' : ''}
							</Button>
						) : null}
					</div>

					<DataTable
						variant="plain"
						columns={columns}
						rows={data?.items ?? []}
						getRowKey={(item) => item.id}
						loading={isLoading}
						error={error}
						errorMessage={t('mumble.tempop.loadFailed')}
						emptyMessage={t('mumble.tempop.empty')}
						rowCount={totalCount}
						itemLabel={t('mumble.tempop.item', { count: totalCount })}
						pageSizeOptions={[10, 25, 50, 100]}
						paginationPosition={hasPagination ? 'both' : 'top'}
						pagination={{ pageIndex: page - 1, pageSize }}
						onPaginationChange={(next) => {
							setPageSize(next.pageSize)
							setPage(next.pageSize === pageSize ? next.pageIndex + 1 : 1)
						}}
					/>
				</CardContent>
			</Card>
		</div>
	)
}
