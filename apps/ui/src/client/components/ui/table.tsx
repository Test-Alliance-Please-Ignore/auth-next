import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

export const stickyTableActionHeaderClassName =
	'sticky right-0 z-20 w-0 min-w-0 whitespace-nowrap !px-4 border-l border-border/60 table-sticky-action-header'
export const stickyTableActionCellClassName =
	'sticky right-0 z-10 w-0 min-w-0 whitespace-nowrap !px-4 border-l border-border/60 table-sticky-action-cell'

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
	containerClassName?: string
	containerRef?: React.Ref<HTMLDivElement>
	onContainerScroll?: React.UIEventHandler<HTMLDivElement>
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
	({ className, containerClassName, containerRef, onContainerScroll, ...props }, ref) => (
		<div
			ref={containerRef}
			onScroll={onContainerScroll}
			className={cn('relative w-full overflow-auto', containerClassName)}
		>
			<table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
		</div>
	)
)
Table.displayName = 'Table'

const TableHeader = React.forwardRef<
	HTMLTableSectionElement,
	React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
	<thead
		ref={ref}
		className={cn(
			'table-header-bg [&_tr]:border-b [&_tr]:bg-transparent! [&_tr]:hover:bg-transparent!',
			className
		)}
		{...props}
	/>
))
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<
	HTMLTableSectionElement,
	React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
	<tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
))
TableBody.displayName = 'TableBody'

const TableFooter = React.forwardRef<
	HTMLTableSectionElement,
	React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
	<tfoot
		ref={ref}
		className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
		{...props}
	/>
))
TableFooter.displayName = 'TableFooter'

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
	({ className, ...props }, ref) => (
		<tr
			ref={ref}
			className={cn(
				'table-row-hover border-b transition-colors odd:bg-muted even:bg-card data-[state=selected]:bg-muted',
				className
			)}
			{...props}
		/>
	)
)
TableRow.displayName = 'TableRow'

const TableHead = React.forwardRef<
	HTMLTableCellElement,
	React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
	<th
		ref={ref}
		className={cn(
			'h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
			className
		)}
		{...props}
	/>
))
TableHead.displayName = 'TableHead'

export type TableSortDirection = 'asc' | 'desc'

interface SortableTableHeadProps extends React.ComponentPropsWithoutRef<typeof TableHead> {
	onSort: () => void
	direction?: TableSortDirection
	disabled?: boolean
	buttonClassName?: string
}

function SortableTableHead({
	children,
	onSort,
	direction,
	disabled = false,
	buttonClassName,
	...props
}: SortableTableHeadProps) {
	const SortIcon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown

	return (
		<TableHead {...props}>
			<button
				type="button"
				onClick={onSort}
				disabled={disabled}
				className={cn(
					'inline-flex items-center gap-1 text-left leading-none text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60',
					buttonClassName
				)}
			>
				<span>{children}</span>
				<SortIcon
					aria-hidden
					className="h-3.5 w-3.5 shrink-0 translate-y-px text-muted-foreground/70"
				/>
			</button>
		</TableHead>
	)
}
SortableTableHead.displayName = 'SortableTableHead'

const TableCell = React.forwardRef<
	HTMLTableCellElement,
	React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
	<td
		ref={ref}
		className={cn('py-2 px-4 align-middle [&:has([role=checkbox])]:pr-0', className)}
		{...props}
	/>
))
TableCell.displayName = 'TableCell'

const TableCaption = React.forwardRef<
	HTMLTableCaptionElement,
	React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
	<caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
))
TableCaption.displayName = 'TableCaption'

export {
	Table,
	TableHeader,
	TableBody,
	TableFooter,
	TableHead,
	SortableTableHead,
	TableRow,
	TableCell,
	TableCaption,
}
