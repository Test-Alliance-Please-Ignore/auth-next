import { useState } from 'react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { formatMoonScanDate } from '../date'
import {
	useRejectScan,
	useRejectScans,
	useScanQueue,
	useVerifyScan,
	useVerifyScans,
} from '../hooks'
import { useMoonScanPermissions } from '../permissions'

import type { ScanQueueEntry } from '../types'

function ValidationActions({ scan }: { scan: ScanQueueEntry }) {
	const { t } = useAppTranslation()

	const [notes, setNotes] = useState('')
	const [expanded, setExpanded] = useState(false)

	const verifyMutation = useVerifyScan()
	const rejectMutation = useRejectScan()

	const isPending = verifyMutation.isPending || rejectMutation.isPending

	function handleVerify() {
		verifyMutation.mutate({ id: scan.id, notes: notes || undefined })
		setExpanded(false)
		setNotes('')
	}

	function handleReject() {
		rejectMutation.mutate({ id: scan.id, notes: notes || undefined })
		setExpanded(false)
		setNotes('')
	}

	return (
		<div className="space-y-2">
			{expanded && (
				<Textarea
					placeholder={t('moonScan.optionalNotes')}
					className="h-16 text-xs"
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
				/>
			)}
			<div className="flex items-center gap-2">
				<Button
					size="sm"
					className="bg-green-600 hover:bg-green-700 text-white"
					disabled={isPending}
					onClick={handleVerify}
				>
					{verifyMutation.isPending ? t('moonScan.verifying') : t('moonScan.verify')}
				</Button>
				<Button size="sm" variant="destructive" disabled={isPending} onClick={handleReject}>
					{rejectMutation.isPending ? t('moonScan.rejecting') : t('moonScan.reject')}
				</Button>
				<Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
					{expanded ? t('moonScan.hideNotes') : t('moonScan.addNote')}
				</Button>
			</div>
		</div>
	)
}

function QueueRow({ scan, canViewMoon }: { scan: ScanQueueEntry; canViewMoon: boolean }) {
	const submittedAt = formatMoonScanDate(scan.submittedAt)
	return (
		<TableRow>
			<TableCell className="text-xs font-medium">
				{canViewMoon ? (
					<Link to={`/moon-scan/moon/${scan.moonId}`} className="hover:underline text-foreground">
						{scan.moonName}
					</Link>
				) : (
					<span>{scan.moonName}</span>
				)}
			</TableCell>
			<TableCell className="text-muted-foreground text-xs">{scan.submittedByName ?? '—'}</TableCell>
			<TableCell className="text-xs">{submittedAt}</TableCell>
			<TableCell>
				<div className="flex flex-wrap gap-1">
					{scan.ores.map((ore) => (
						<Badge key={ore.oreTypeId} variant="ghost" className="text-xs">
							{ore.oreTypeName} {(parseFloat(ore.quantity) * 100).toFixed(1)}%
						</Badge>
					))}
				</div>
			</TableCell>
			<TableCell>
				<ValidationActions scan={scan} />
			</TableCell>
		</TableRow>
	)
}

export default function QueuePage() {
	const { t } = useAppTranslation()

	usePageTitle(t('moonScan.moonScanReviewQueue'))

	const { canValidate, canView } = useMoonScanPermissions()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(20)

	const { data, isLoading, error } = useScanQueue({ page, pageSize }, canValidate)
	const verifyAllMutation = useVerifyScans()
	const rejectAllMutation = useRejectScans()

	if (!canValidate) {
		return (
			<Container>
				<PageHeader
					title={t('moonScan.validationQueue')}
					description={t('moonScan.youDoNotHavePermissionToValidateScans')}
				/>
			</Container>
		)
	}

	const totalCount = data?.total ?? 0
	const hasPagination = Math.ceil(totalCount / pageSize) > 1
	const pendingScanIds = data?.items.map((scan) => scan.id) ?? []
	const pendingScanCount = pendingScanIds.length

	function handleApproveAll() {
		if (pendingScanIds.length === 0 || verifyAllMutation.isPending) return
		requestConfirmation({
			title: t('moonScan.approveAllScansOnThisPage'),
			description: t('moonScan.verifyPendingScans', { count: pendingScanIds.length }),
			confirmLabel: t('moonScan.approveAll'),
			confirmButtonVariant: 'success',
			onConfirm: async () => {
				try {
					const verified = await verifyAllMutation.mutateAsync(pendingScanIds)
					toast.success(t('moonScan.approvedPendingScans', { count: verified.length }))
				} catch (error) {
					toast.error(error instanceof Error ? error.message : t('moonScan.failedToApproveScans'))
				}
			},
		})
	}

	function handleRejectAll() {
		if (pendingScanIds.length === 0 || rejectAllMutation.isPending) return
		requestConfirmation({
			title: t('moonScan.rejectAllScansOnThisPage'),
			description: t('moonScan.rejectPendingScans', { count: pendingScanIds.length }),
			confirmLabel: t('moonScan.rejectAll'),
			intent: 'destructive',
			onConfirm: async () => {
				try {
					const rejected = await rejectAllMutation.mutateAsync(pendingScanIds)
					toast.success(t('moonScan.rejectedPendingScans', { count: rejected.length }))
				} catch (error) {
					toast.error(error instanceof Error ? error.message : t('moonScan.failedToRejectScans'))
				}
			},
		})
	}

	const renderPaginationControls = () => (
		<UserSearchPaginationControls
			totalCount={totalCount}
			page={page}
			pageSize={pageSize}
			onPageChange={setPage}
			onPageSizeChange={(nextPageSize) => {
				setPageSize(nextPageSize)
				setPage(1)
			}}
			pageSizeOptions={[20, 50, 100]}
			itemLabel={t('moonScan.pendingScans')}
		/>
	)

	return (
		<Container>
			<PageHeader
				title={t('moonScan.validationQueue')}
				description={t('moonScan.reviewAndApprovePendingMoonScanSubmissions')}
				action={
					<div className="flex flex-wrap gap-2">
						<Button
							variant="success"
							disabled={isLoading || pendingScanCount === 0 || verifyAllMutation.isPending}
							onClick={handleApproveAll}
						>
							{verifyAllMutation.isPending
								? t('moonScan.approving')
								: pendingScanCount > 0
									? t('moonScan.approveAll1', { value1: pendingScanCount })
									: t('moonScan.approveAll2')}
						</Button>
						<Button
							variant="destructive"
							disabled={isLoading || pendingScanCount === 0 || rejectAllMutation.isPending}
							onClick={handleRejectAll}
						>
							{rejectAllMutation.isPending
								? t('moonScan.rejecting')
								: pendingScanCount > 0
									? t('moonScan.rejectAll3', { value1: pendingScanCount })
									: t('moonScan.rejectAll4')}
						</Button>
					</div>
				}
			/>

			{error && (
				<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					{t('moonScan.failedToLoadQueue')}
				</div>
			)}

			<Card className="mt-section">
				{hasPagination && <div className="border-b p-4">{renderPaginationControls()}</div>}
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t('moonScan.moon')}</TableHead>
							<TableHead>{t('moonScan.submittedBy2')}</TableHead>
							<TableHead>{t('moonScan.date')}</TableHead>
							<TableHead>{t('moonScan.composition')}</TableHead>
							<TableHead>{t('moonScan.actions')}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading
							? Array.from({ length: 5 }).map((_, i) => (
									<TableRow key={i}>
										{Array.from({ length: 5 }).map((__, j) => (
											<TableCell key={j}>
												<Skeleton className="h-4 w-20" />
											</TableCell>
										))}
									</TableRow>
								))
							: (data?.items ?? []).map((scan) => (
									<QueueRow key={scan.id} scan={scan} canViewMoon={canView} />
								))}
						{!isLoading && data?.items.length === 0 && (
							<TableRow>
								<TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
									{t('moonScan.noPendingScansToReview')}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>

				{hasPagination && <div className="border-t p-4">{renderPaginationControls()}</div>}
			</Card>
			{confirmationDialog}
		</Container>
	)
}
