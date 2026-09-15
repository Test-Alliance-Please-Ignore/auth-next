import { Loader2 } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { formatNumber, useAppTranslation } from '@/i18n'

import type { ReactNode } from 'react'

interface UserSearchPaginationControlsProps {
	totalCount: number
	page: number
	pageSize: number
	onPageChange: (page: number) => void
	onPageSizeChange: (pageSize: number) => void
	pageSizeOptions?: number[]
	itemLabel?: string
	nextButtonLoading?: boolean
	leadingAction?: ReactNode
	trailingAction?: ReactNode
	controlsLeadingAction?: ReactNode
}

const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100]

export function UserSearchPaginationControls({
	totalCount,
	page,
	pageSize,
	onPageChange,
	onPageSizeChange,
	pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
	itemLabel,
	nextButtonLoading = false,
	leadingAction,
	trailingAction,
	controlsLeadingAction,
}: UserSearchPaginationControlsProps) {
	const { t } = useAppTranslation()
	const pageSizeId = useId()
	const resolvedItemLabel = itemLabel ?? t('pagination.users', { count: totalCount })
	const totalPages = Math.ceil(totalCount / pageSize)
	const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
	const end = Math.min(page * pageSize, totalCount)
	const canGoPrev = page > 1
	const canGoNext = page < totalPages
	const maxVisiblePages = 5
	const startPage = Math.max(1, page - Math.floor(maxVisiblePages / 2))
	const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1)
	const adjustedStartPage = Math.max(1, endPage - maxVisiblePages + 1)
	const visiblePages = Array.from(
		{ length: Math.max(0, endPage - adjustedStartPage + 1) },
		(_, index) => adjustedStartPage + index
	)

	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				{leadingAction ? <div className="shrink-0">{leadingAction}</div> : null}
				<div>
					{totalCount > 0
						? t('pagination.range', {
								start: formatNumber(start),
								end: formatNumber(end),
								total: formatNumber(totalCount),
								itemLabel: resolvedItemLabel,
							})
						: t('pagination.empty', { itemLabel: resolvedItemLabel })}
				</div>
				{trailingAction ? <div className="shrink-0">{trailingAction}</div> : null}
			</div>
			<div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
				{controlsLeadingAction ? (
					<div className="flex shrink-0 items-center">{controlsLeadingAction}</div>
				) : null}
				<div className="flex shrink-0 items-center gap-2">
					<label htmlFor={pageSizeId} className="text-sm text-muted-foreground">
						{t('pagination.perPage')}
					</label>
					<Select
						inputId={pageSizeId}
						value={String(pageSize)}
						onValueChange={(value) => onPageSizeChange(Number(value))}
						options={pageSizeOptions.map((size) => ({
							value: String(size),
							label: formatNumber(size),
						}))}
						className="h-9 w-20"
						inputClassName="h-9"
					/>
				</div>
				<Button variant="ghost" size="sm" disabled={!canGoPrev} onClick={() => onPageChange(1)}>
					{t('pagination.first')}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={!canGoPrev}
					onClick={() => onPageChange(page - 1)}
				>
					{t('pagination.previous')}
				</Button>
				{visiblePages.map((pageNumber) => (
					<Button
						key={pageNumber}
						variant={pageNumber === page ? 'secondary' : 'ghost'}
						size="sm"
						aria-current={pageNumber === page ? 'page' : undefined}
						onClick={() => onPageChange(pageNumber)}
					>
						{formatNumber(pageNumber)}
					</Button>
				))}
				<Button
					variant="ghost"
					size="sm"
					className="relative min-w-16"
					disabled={!canGoNext}
					aria-busy={nextButtonLoading}
					onClick={() => onPageChange(page + 1)}
				>
					<span className={nextButtonLoading ? 'opacity-0' : undefined}>
						{t('pagination.next')}
					</span>
					{nextButtonLoading ? (
						<Loader2
							aria-hidden
							className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin"
						/>
					) : null}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={!canGoNext}
					onClick={() => onPageChange(totalPages)}
				>
					{t('pagination.last')}
				</Button>
			</div>
		</div>
	)
}
