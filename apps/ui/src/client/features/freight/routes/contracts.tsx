import { ExternalLink, Package } from 'lucide-react'
import { useMemo } from 'react'
import { MantineReactTable, useMantineReactTable } from 'mantine-react-table'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import {
    mrtPaperProps,
    mrtPaginationProps,
    mrtRowStyle,
    mrtTableBodyCellProps,
    mrtTableContainerProps,
    mrtTableHeadCellProps,
    mrtTableHeadProps,
    mrtTableProps,
} from '@/lib/mrt-theme'
import { useFreightContracts, useOpenContractInGame } from '@/hooks/useFreightContracts'
import { usePageTitle } from '@/hooks/usePageTitle'

import { formatISK, formatNumber } from '../utils'

import type { FreightContract } from '@/lib/freight-api'
import type { MRT_ColumnDef } from 'mantine-react-table'

function formatVolume(volume: string | null): string {
    if (!volume) return '—'
    return `${formatNumber(volume)} m³`
}

function formatTimeRemaining(dateExpired: string): string {
    const now = Date.now()
    const expiry = new Date(dateExpired).getTime()
    const diff = expiry - now
    if (diff <= 0) return 'Expired'

    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

    if (days > 0) return `${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`
    return `${hours} hour${hours !== 1 ? 's' : ''}`
}

const baseColumns: MRT_ColumnDef<FreightContract>[] = [
    {
        accessorKey: 'startLocationName',
        header: 'Pickup',
        Cell: ({ row }) =>
            row.original.startLocationName ?? row.original.startLocationId ?? '—',
    },
    {
        accessorKey: 'endLocationName',
        header: 'Dropoff',
        Cell: ({ row }) =>
            row.original.endLocationName ?? row.original.endLocationId ?? '—',
    },
    {
        accessorKey: 'volume',
        header: 'Volume',
        mantineTableBodyCellProps: { style: { textAlign: 'right', fontFamily: 'monospace', borderBottom: '1px solid hsl(var(--border) / 0.7)', color: 'hsl(var(--foreground))' } },
        Cell: ({ row }) => formatVolume(row.original.volume),
        sortingFn: (a, b) =>
            (parseFloat(a.original.volume ?? '0') || 0) -
            (parseFloat(b.original.volume ?? '0') || 0),
    },
    {
        accessorKey: 'reward',
        header: 'Reward',
        mantineTableBodyCellProps: { style: { textAlign: 'right', fontFamily: 'monospace', borderBottom: '1px solid hsl(var(--border) / 0.7)', color: 'hsl(var(--foreground))' } },
        Cell: ({ row }) => (row.original.reward ? formatISK(row.original.reward) : '—'),
        sortingFn: (a, b) =>
            (parseFloat(a.original.reward ?? '0') || 0) -
            (parseFloat(b.original.reward ?? '0') || 0),
    },
    {
        accessorKey: 'collateral',
        header: 'Collateral',
        mantineTableBodyCellProps: { style: { textAlign: 'right', fontFamily: 'monospace', borderBottom: '1px solid hsl(var(--border) / 0.7)', color: 'hsl(var(--foreground))' } },
        Cell: ({ row }) =>
            row.original.collateral ? formatISK(row.original.collateral) : '—',
        sortingFn: (a, b) =>
            (parseFloat(a.original.collateral ?? '0') || 0) -
            (parseFloat(b.original.collateral ?? '0') || 0),
    },
    {
        accessorKey: 'daysToComplete',
        header: 'TTC',
        mantineTableBodyCellProps: { style: { textAlign: 'center', fontFamily: 'monospace', borderBottom: '1px solid hsl(var(--border) / 0.7)', color: 'hsl(var(--foreground))' } },
        Cell: ({ row }) => row.original.daysToComplete ?? '—',
        size: 80,
    },
    {
        accessorKey: 'dateExpired',
        header: 'Expires',
        Cell: ({ row }) => formatTimeRemaining(row.original.dateExpired),
        sortingFn: (a, b) =>
            new Date(a.original.dateExpired).getTime() -
            new Date(b.original.dateExpired).getTime(),
    },
]

export default function FreightContractsPage() {
    usePageTitle('Open Contracts')

    const { data: contracts, isLoading } = useFreightContracts({ status: 'outstanding' })
    const openInGame = useOpenContractInGame()

    const data = useMemo(() => contracts ?? [], [contracts])

    const columns = useMemo<Array<MRT_ColumnDef<FreightContract>>>(
        () => [
            ...baseColumns,
            {
                id: 'openInGame',
                header: '',
                enableSorting: false,
                size: 110,
                mantineTableBodyCellProps: {
                    style: {
                        textAlign: 'center',
                        borderBottom: '1px solid hsl(var(--border) / 0.7)',
                    },
                },
                Cell: ({ row }) => {
                    const { contractId } = row.original
                    const isPending =
                        openInGame.isPending && openInGame.variables === contractId
                    return (
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={openInGame.isPending}
                            onClick={() => openInGame.mutate(contractId)}
                            title="Open this contract in your EVE client"
                        >
                            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                            {isPending ? 'Opening…' : 'In-game'}
                        </Button>
                    )
                },
            },
        ],
        [openInGame]
    )

    const table = useMantineReactTable({
        columns,
        data,
        enableColumnActions: false,
        enableColumnFilters: false,
        enableDensityToggle: false,
        enableFullScreenToggle: false,
        enableGlobalFilter: false,
        enableHiding: false,
        enableTopToolbar: false,
        enableSorting: true,
        enablePagination: true,
        initialState: {
            sorting: [{ id: 'dateExpired', desc: false }],
        },
        enableStickyHeader: true,
        paginationDisplayMode: 'pages',
        mantinePaginationProps: mrtPaginationProps,
        mantinePaperProps: mrtPaperProps,
        mantineTableContainerProps: {
            ...mrtTableContainerProps,
            style: { maxHeight: 'calc(100vh - 16rem)' },
        },
        mantineTableProps: mrtTableProps,
        mantineTableHeadProps: mrtTableHeadProps,
        mantineTableHeadCellProps: mrtTableHeadCellProps,
        mantineTableBodyCellProps: mrtTableBodyCellProps,
        mantineTableBodyRowProps: ({ row }) => ({
            className: 'mrt-grid__row',
            style: mrtRowStyle(row.index),
        }),
        renderEmptyRowsFallback: () => (
            <div className="flex min-h-40 items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
                <div>
                    <Package className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                    <p>No outstanding contracts</p>
                </div>
            </div>
        ),
        state: {
            isLoading,
            showProgressBars: isLoading,
        },
    })

    return (
        <Container size="wide">
            <div className="mb-section md:mb-10">
                <h1 className="text-3xl font-bold gradient-text">Open Contracts</h1>
                <p className="text-muted-foreground mt-1">
                    Outstanding courier contracts waiting to be picked up
                </p>
            </div>

            <MantineReactTable table={table} />
        </Container>
    )
}
