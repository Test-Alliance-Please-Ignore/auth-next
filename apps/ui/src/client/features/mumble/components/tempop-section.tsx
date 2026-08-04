import { Link2, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import toast from '@/lib/toast'

import { useCreateTempop, useDeleteTempop, useTempops } from '../tempop-hooks'
import { CopyRow } from './credentials-card'

import type { CreateTempopResponse, TempopListFilters, TempopListItem } from '@/lib/api'

const ALL_CREATORS = '__all__'

const TTL_OPTIONS = [
	{ value: '1h', label: '1 hour' },
	{ value: '4h', label: '4 hours' },
	{ value: '6h', label: '6 hours' },
	{ value: 'custom', label: 'Custom…' },
]

const STATUS_OPTIONS = [
	{ value: 'active', label: 'Active' },
	{ value: 'expired', label: 'Expired' },
	{ value: 'deleted', label: 'Deleted' },
	{ value: 'all', label: 'All' },
]

type StatusFilter = 'active' | 'expired' | 'deleted' | 'all'

function formatExpiry(item: TempopListItem): string {
	if (item.status === 'deleted') return 'Deleted'
	const remainingMs = new Date(item.expiresAt).getTime() - Date.now()
	if (item.status === 'expired' || remainingMs <= 0) return 'Expired'
	const totalMinutes = Math.floor(remainingMs / 60000)
	const hours = Math.floor(totalMinutes / 60)
	const minutes = totalMinutes % 60
	return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' {
	if (status === 'active') return 'default'
	if (status === 'deleted') return 'destructive'
	return 'secondary'
}

/** Permission-gated create card. */
function CreateTempopCard() {
	const create = useCreateTempop()
	const [ttlMode, setTtlMode] = useState('1h')
	const [customHours, setCustomHours] = useState('2')
	const [generated, setGenerated] = useState<(CreateTempopResponse & { url: string }) | null>(null)

	const customHoursNumber = Number(customHours)
	const customInvalid =
		ttlMode === 'custom' &&
		(!Number.isFinite(customHoursNumber) || customHoursNumber <= 0 || customHoursNumber > 12)

	const handleGenerate = () => {
		const input =
			ttlMode === 'custom'
				? { customHours: customHoursNumber }
				: { ttlPreset: ttlMode as '1h' | '4h' | '6h' }
		create.mutate(input, {
			onSuccess: (res) => {
				setGenerated({ ...res, url: `${window.location.origin}/tempop/${res.token}` })
			},
			onError: (error) => {
				toast.error(error instanceof Error ? error.message : 'Failed to create temp-op')
			},
		})
	}

	return (
		<Card variant="default">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Link2 className="h-5 w-5" />
					Create a temp-op link
				</CardTitle>
				<CardDescription>
					Generate a time-limited link that lets guests join voice after a quick EVE login. Guests
					are placed in the <span className="font-mono">TempOp</span> group and disconnected when
					the temp-op expires or is deleted.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-end gap-3">
					<div className="space-y-1">
						<Label htmlFor="tempop-ttl">Duration</Label>
						<Select
							inputId="tempop-ttl"
							options={TTL_OPTIONS}
							value={ttlMode}
							onValueChange={(value) => setTtlMode(value)}
							className="w-40"
						/>
					</div>
					{ttlMode === 'custom' ? (
						<div className="space-y-1">
							<Label htmlFor="tempop-custom-hours">Hours (max 12)</Label>
							<Input
								id="tempop-custom-hours"
								type="number"
								min={1}
								max={12}
								value={customHours}
								onChange={(e) => setCustomHours(e.target.value)}
								className="w-28"
							/>
						</div>
					) : null}
					<Button onClick={handleGenerate} disabled={create.isPending || customInvalid}>
						{create.isPending ? 'Generating…' : 'Generate link'}
					</Button>
				</div>

				{customInvalid ? (
					<p className="text-sm text-destructive">
						Custom duration must be between 1 and 12 hours.
					</p>
				) : null}

				{generated ? (
					<div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
						<p className="text-sm">
							Share this link (code <span className="font-mono">{generated.shortCode}</span>). It
							expires {new Date(generated.expiresAt).toLocaleString()}.
						</p>
						<CopyRow label="Link" value={generated.url} />
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}

/** A single temp-op table row with an optional delete control. */
function TempopTableRow({ item }: { item: TempopListItem }) {
	const del = useDeleteTempop()
	const [confirmOpen, setConfirmOpen] = useState(false)

	const handleDelete = () => {
		del.mutate(item.id, {
			onSuccess: (result) => {
				toast.success(
					result.disconnected > 0
						? `Temp-op deleted; disconnected ${result.disconnected} guest(s)`
						: 'Temp-op deleted'
				)
				setConfirmOpen(false)
			},
			onError: (error) => {
				toast.error(error instanceof Error ? error.message : 'Failed to delete temp-op')
				setConfirmOpen(false)
			},
		})
	}

	return (
		<>
			<TableRow>
				<TableCell className="font-mono font-medium">{item.shortCode}</TableCell>
				<TableCell>{item.creatorName ?? 'Unknown'}</TableCell>
				<TableCell>{item.groupName}</TableCell>
				<TableCell>
					<Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
				</TableCell>
				<TableCell>
					<span className="flex items-center gap-1">
						<Users className="h-4 w-4 text-muted-foreground" />
						{item.guestCount}
					</span>
				</TableCell>
				<TableCell>{formatExpiry(item)}</TableCell>
				<TableCell className="text-right">
					{item.canDelete && item.status !== 'deleted' ? (
						<Button
							variant="destructive"
							size="sm"
							onClick={() => setConfirmOpen(true)}
							disabled={del.isPending}
						>
							<Trash2 className="mr-1 h-4 w-4" />
							Delete
						</Button>
					) : (
						<span className="text-sm text-muted-foreground">—</span>
					)}
				</TableCell>
			</TableRow>

			<ConfirmationDialog
				open={confirmOpen}
				title="Delete temp-op?"
				description="All guests connected via this link are disconnected immediately and their accounts removed."
				confirmLabel="Delete"
				pending={del.isPending}
				onCancel={() => setConfirmOpen(false)}
				onConfirm={handleDelete}
			/>
		</>
	)
}

function PaginationControls({
	totalCount,
	page,
	pageSize,
	onPageChange,
	onPageSizeChange,
}: {
	totalCount: number
	page: number
	pageSize: number
	onPageChange: (page: number) => void
	onPageSizeChange: (pageSize: number) => void
}) {
	return (
		<UserSearchPaginationControls
			totalCount={totalCount}
			page={page}
			pageSize={pageSize}
			onPageChange={onPageChange}
			onPageSizeChange={onPageSizeChange}
			pageSizeOptions={[10, 25, 50, 100]}
			itemLabel="temp-ops"
		/>
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
			{ value: ALL_CREATORS, label: 'All creators' },
			...(data?.creators ?? []).map((creator) => ({
				value: creator.id,
				label: creator.name ?? creator.id,
			})),
		],
		[data?.creators]
	)

	const resetPage = () => setPage(1)

	return (
		<div className="space-y-4">
			{canCreate ? <CreateTempopCard /> : null}

			<Card variant="default">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-sm font-medium">
						<Link2 className="h-4 w-4" />
						Temp-ops
					</CardTitle>
					<CardDescription>Active and past temporary operation links.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex flex-wrap items-end gap-3">
						<div className="space-y-1">
							<Label htmlFor="tempop-status">Status</Label>
							<Select
								inputId="tempop-status"
								options={STATUS_OPTIONS}
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
								<Label htmlFor="tempop-creator">Creator</Label>
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
								onClick={() => {
									setMine((v) => !v)
									resetPage()
								}}
							>
								{mine ? 'Mine only ✓' : 'Mine only'}
							</Button>
						) : null}
					</div>

					{error ? (
						<p className="text-sm text-destructive">Failed to load temp-ops.</p>
					) : isLoading ? (
						<p className="text-sm text-muted-foreground">Loading temp-ops…</p>
					) : data && data.items.length > 0 ? (
						<div className="space-y-4">
							<PaginationControls
								totalCount={totalCount}
								page={page}
								pageSize={pageSize}
								onPageChange={setPage}
								onPageSizeChange={(nextPageSize) => {
									setPageSize(nextPageSize)
									setPage(1)
								}}
							/>

							<div className="rounded-md border bg-card">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Short Code</TableHead>
											<TableHead>Creator</TableHead>
											<TableHead>Group</TableHead>
											<TableHead>Status</TableHead>
											<TableHead>Guests</TableHead>
											<TableHead>Expires</TableHead>
											<TableHead className="text-right">Actions</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data.items.map((item) => (
											<TempopTableRow key={item.id} item={item} />
										))}
									</TableBody>
								</Table>
							</div>

							{hasPagination ? (
								<div className="border-t border-border pt-4">
									<PaginationControls
										totalCount={totalCount}
										page={page}
										pageSize={pageSize}
										onPageChange={setPage}
										onPageSizeChange={(nextPageSize) => {
											setPageSize(nextPageSize)
											setPage(1)
										}}
									/>
								</div>
							) : null}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">No temp-ops match these filters.</p>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
