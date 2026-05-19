import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ArrowDown, ArrowUp } from 'lucide-react'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatISK } from '@/lib/format-utils'

import { RARITY_COLORS } from '../ore-rarities'
import { useScannedMoons, useMoonRegions } from '../hooks'
import { useMoonScanPermissions } from '../permissions'
import { parseSecurityStatus, securityStatusTextClass } from '../security-status'

import type { OreRarity, ScannedMoonEntry } from '../types'

const RARITY_TABS = ['All', 'R4', 'R8', 'R16', 'R32', 'R64'] as const
type RarityTab = (typeof RARITY_TABS)[number]
type SortBy =
	| 'moonName'
	| 'solarSystemName'
	| 'regionName'
	| 'securityStatus'
	| 'highestRarity'
	| 'metenoxProfit'
	| 'tataraProfit'
type SortDir = 'asc' | 'desc'

function RarityBadge({ rarity }: { rarity: OreRarity }) {
	return (
		<span
			className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold text-white"
			style={{ backgroundColor: RARITY_COLORS[rarity] }}
		>
			{rarity}
		</span>
	)
}

function ProfitCell({ value }: { value: string | null }) {
	if (value === null) return <span className="text-muted-foreground">—</span>
	const n = parseFloat(value)
	return (
		<span className={n >= 0 ? 'text-green-400' : 'text-red-400'}>
			{formatISK(value, { showDecimals: false })}
		</span>
	)
}

function MoonRow({ moon }: { moon: ScannedMoonEntry }) {
	const sec = parseSecurityStatus(moon.securityStatus)
	return (
		<TableRow>
			<TableCell>
				<Link to={`/moon-scan/moon/${moon.moonId}`} className="hover:underline text-foreground font-medium">
					{moon.moonName}
				</Link>
			</TableCell>
			<TableCell>
				<Link to={`/moon-scan/system/${moon.solarSystemId}`} className="hover:underline text-muted-foreground text-sm">
					{moon.solarSystemName}
				</Link>
			</TableCell>
			<TableCell className="text-sm text-muted-foreground">{moon.regionName}</TableCell>
			<TableCell className={`font-mono text-xs ${securityStatusTextClass(sec)}`}>
				{sec === null ? '—' : sec.toFixed(1)}
			</TableCell>
			<TableCell>
				{moon.highestRarity ? <RarityBadge rarity={moon.highestRarity as OreRarity} /> : <span className="text-muted-foreground">—</span>}
			</TableCell>
			<TableCell className="text-right tabular-nums">
				<ProfitCell value={moon.metenoxProfit} />
			</TableCell>
			<TableCell className="text-right tabular-nums">
				<ProfitCell value={moon.tataraProfit} />
			</TableCell>
		</TableRow>
	)
}

export default function ScannedMoonsPage() {
	const { canView } = useMoonScanPermissions()

	const [rarityTab, setRarityTab] = useState<RarityTab>('All')
	const [regionFilter, setRegionFilter] = useState<string>('all')
	const [search, setSearch] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(50)
	const [sortBy, setSortBy] = useState<SortBy>('moonName')
	const [sortDir, setSortDir] = useState<SortDir>('asc')

	const { data, isLoading, error } = useScannedMoons({
		page,
		pageSize,
		regionId: regionFilter,
		rarity: rarityTab,
		search,
		sortBy,
		sortDir,
	})
	const { data: regionsData } = useMoonRegions()

	const regions = useMemo(() => {
		if (!regionsData) return []
		return [...regionsData.regions].sort((a, b) => a.regionName.localeCompare(b.regionName))
	}, [regionsData])
	const regionOptions = useMemo(
		() => [
			{ value: 'all', label: 'All Regions' },
			...regions.map((region) => ({ value: region.regionId, label: region.regionName })),
		],
		[regions]
	)

	const totalCount = data?.total ?? 0
	const hasPagination = Math.ceil(totalCount / pageSize) > 1
	const toggleSort = (column: SortBy) => {
		if (sortBy === column) {
			setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
		} else {
			setSortBy(column)
			setSortDir('asc')
		}
		setPage(1)
	}
	const SortIndicator = ({ column }: { column: SortBy }) => {
		if (sortBy !== column) return null
		return sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
	}
	const SortableHead = ({
		label,
		column,
		className,
		alignRight = false,
	}: {
		label: string
		column: SortBy
		className?: string
		alignRight?: boolean
	}) => (
		<TableHead className={className}>
			<button
				type="button"
				onClick={() => toggleSort(column)}
				className={`inline-flex items-center gap-1.5 hover:text-foreground ${alignRight ? 'w-full justify-end' : ''}`}
			>
				<span>{label}</span>
				<SortIndicator column={column} />
			</button>
		</TableHead>
	)
	const renderPaginationControls = () => (
		<UserSearchPaginationControls
			totalCount={totalCount}
			page={page}
			pageSize={pageSize}
			onPageChange={setPage}
			onPageSizeChange={(size) => {
				setPageSize(size)
				setPage(1)
			}}
			itemLabel="moons"
		/>
	)

	if (!canView) {
		return (
			<Container>
				<PageHeader title="Scanned Moons" description="You do not have permission to view moon data." />
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title="Scanned Moons"
				description="All verified moon compositions with profitability estimates"
			/>

			{error && (
				<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					Failed to load moon data
				</div>
			)}

			{/* Filters */}
			<div className="mt-section flex flex-wrap items-center gap-3">
					{/* Rarity tabs */}
					<Tabs value={rarityTab} onValueChange={(value) => setRarityTab(value as RarityTab)}>
						<TabsList className="rounded-md border bg-card p-1">
							{RARITY_TABS.map((tab) => (
								<TabsTrigger
									key={tab}
									value={tab}
									className="rounded px-2.5 py-1 text-xs font-medium"
									style={tab !== 'All' ? { color: RARITY_COLORS[tab as OreRarity] } : undefined}
									onClick={() => setPage(1)}
								>
									{tab}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>

				{/* Region dropdown */}
					<Select
						value={regionFilter}
						onValueChange={(value) => {
							setRegionFilter(value)
							setPage(1)
						}}
						options={regionOptions}
						searchable
						placeholder="Filter region..."
						className="w-56"
						inputClassName="h-9"
					/>

				{/* Name / system search */}
				<Input
					className="w-56"
					placeholder="Search moon or system…"
					value={search}
					onChange={(e) => {
						setSearch(e.target.value)
						setPage(1)
					}}
				/>

				{!isLoading && data && (
					<span className="ml-auto text-xs text-muted-foreground">
						{data.items.length} shown • {data.total} total
					</span>
				)}
			</div>

			<Card className="mt-4 overflow-hidden">
				{hasPagination && <div className="border-b p-4">{renderPaginationControls()}</div>}
				<Table>
					<TableHeader>
						<TableRow>
							<SortableHead label="Moon" column="moonName" />
							<SortableHead label="System" column="solarSystemName" />
							<SortableHead label="Region" column="regionName" />
							<SortableHead label="Security" column="securityStatus" />
							<SortableHead label="Rarity" column="highestRarity" />
							<SortableHead
								label="Metenox 30d"
								column="metenoxProfit"
								className="text-right"
								alignRight
							/>
							<SortableHead
								label="Refinery 30d"
								column="tataraProfit"
								className="text-right"
								alignRight
							/>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading
							? Array.from({ length: 8 }).map((_, i) => (
									<TableRow key={i}>
										{Array.from({ length: 7 }).map((__, j) => (
											<TableCell key={j}>
												<Skeleton className="h-4 w-20" />
											</TableCell>
										))}
									</TableRow>
								))
							: (data?.items ?? []).map((moon) => <MoonRow key={moon.moonId} moon={moon} />)}
						{!isLoading && (data?.items.length ?? 0) === 0 && (
							<TableRow>
								<TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
									No moons match the current filters.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
				{hasPagination && <div className="border-t p-4">{renderPaginationControls()}</div>}
			</Card>
		</Container>
	)
}
