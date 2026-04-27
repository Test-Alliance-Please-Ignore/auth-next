import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'

interface UserSearchPaginationControlsProps {
	totalCount: number
	page: number
	pageSize: number
	onPageChange: (page: number) => void
	onPageSizeChange: (pageSize: number) => void
	pageSizeOptions?: number[]
}

const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100]

export function UserSearchPaginationControls({
	totalCount,
	page,
	pageSize,
	onPageChange,
	onPageSizeChange,
	pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: UserSearchPaginationControlsProps) {
	const totalPages = Math.ceil(totalCount / pageSize)
	const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
	const end = Math.min(page * pageSize, totalCount)
	const canGoPrev = page > 1
	const canGoNext = page < totalPages

	return (
		<div className="flex items-center justify-between gap-3">
			<div className="text-sm text-muted-foreground">
				{totalCount > 0 ? `${start}-${end} of ${totalCount} users` : '0 users'}
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
				<div className="text-sm text-muted-foreground min-w-[64px] text-right">
					{totalPages > 0 ? `${page}/${totalPages}` : '0/0'}
				</div>
				<Button
					variant="ghost"
					size="sm"
					disabled={!canGoPrev}
					onClick={() => onPageChange(page - 1)}
				>
					Prev
				</Button>
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
