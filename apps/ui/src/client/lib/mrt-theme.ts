import type React from 'react'

// Shared prop objects for useMantineReactTable calls.
// Spread these into your table config to get consistent styling across all MRT grids.
// All visual styling (header color, alternating rows, hover) lives in globals.css
// scoped under .mrt-grid__paper — no inline background overrides needed.

export const mrtPaperProps = {
	shadow: 'none' as const,
	radius: 'md' as const,
	withBorder: true,
	className: 'mrt-grid__paper',
	style: {
		background: 'hsl(var(--card))',
		borderColor: 'hsl(var(--border))',
		color: 'hsl(var(--foreground))',
		overflow: 'hidden',
	},
} as const

export const mrtTableContainerProps = {
	className: 'mrt-grid__container',
} as const

export const mrtTableProps = {
	striped: false,
	highlightOnHover: false,
	withColumnBorders: false,
	withRowBorders: true,
	className: 'mrt-grid__table',
	style: {
		background: 'transparent',
		color: 'hsl(var(--foreground))',
	},
} as const

export const mrtTableHeadProps = {
	className: 'mrt-grid__head',
} as const

export const mrtTableHeadCellProps = {
	className: 'mrt-grid__head-cell',
	style: {
		borderBottom: '1px solid hsl(var(--border))',
		color: 'hsl(var(--muted-foreground))',
		fontSize: '0.75rem',
		fontWeight: 700,
		letterSpacing: '0.03em',
		textTransform: 'uppercase' as const,
	},
} as const

export const mrtTableBodyCellProps = {
	className: 'mrt-grid__body-cell',
	style: {
		borderBottom: '1px solid hsl(var(--border) / 0.7)',
		color: 'hsl(var(--foreground))',
	},
} as const

// Returns the alternating row background style for a given row index.
// Use this in mantineTableBodyRowProps since MRT's DOM structure makes pure CSS nth-child unreliable.
export function mrtRowStyle(index: number): React.CSSProperties {
	return { background: index % 2 === 0 ? 'hsl(var(--card))' : 'hsl(var(--muted))' }
}

export const mrtPaginationProps = {
	showRowsPerPage: true,
	rowsPerPageOptions: ['25', '50', '100', '200'] as string[],
}
