import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'

interface UserSearchPaginationControlsProps {
	totalCount: number
	page: number
	pageSize: number
	onPageChange: (page: number) => void
	onPageSizeChange: (pageSize: number) => void
	pageSizeOptions?: number[]
	itemLabel?: string
}

const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100]

export function UserSearchPaginationControls({
	totalCount,
	page,
	pageSize,
	onPageChange,
	onPageSizeChange,
	pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
	itemLabel = 'users',
}: UserSearchPaginationControlsProps) {
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
		<div className="flex items-center justify-between gap-3">
			<div className="text-sm text-muted-foreground">
				{totalCount > 0
					? `${start}-${end} of ${totalCount} ${itemLabel}`
					: `0 ${itemLabel}`}
			</div>
			<div className="flex items-center gap-2 justify-end">
				<div className="flex items-center gap-2">
					<span className="text-sm text-muted-foreground">Per page:</span>
					<Select
						value={String(pageSize)}
						onValueChange={(value) => onPageSizeChange(Number(value))}
						options={pageSizeOptions.map((size) => ({
							value: String(size),
							label: String(size),
						}))}
						className="h-9 w-20"
						inputClassName="h-9"
					/>
				</div>
				<Button
					variant="ghost"
					size="sm"
					disabled={!canGoPrev}
					onClick={() => onPageChange(page - 1)}
				>
					Prev
				</Button>
				{visiblePages.map((pageNumber) => (
					<Button
						key={pageNumber}
						variant={pageNumber === page ? 'secondary' : 'ghost'}
						size="sm"
						onClick={() => onPageChange(pageNumber)}
					>
						{pageNumber}
					</Button>
				))}
				<Button
					variant="ghost"
					size="sm"
					disabled={!canGoNext}
					onClick={() => onPageChange(page + 1)}
				>
					Next
				</Button>
			</div>
		</div>
	)
}
