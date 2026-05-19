import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react'

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
import { formatISK } from '@/lib/format-utils'

import { RARITY_COLORS } from '../ore-rarities'
import { useScannedMoons, useMoonRegions } from '../hooks'
import { useMoonScanPermissions } from '../permissions'

import type { OreRarity, ScannedMoonEntry } from '../types'

const RARITY_VALUES: readonly OreRarity[] = ['R4', 'R8', 'R16', 'R32', 'R64']
type SortField = 'metenox' | 'tatara'
type SortDir = 'asc' | 'desc'

function secColor(sec: string | null): string {
	if (sec === null) return 'text-muted-foreground'
	const s = parseFloat(sec)
	if (s >= 0.5) return 'text-green-400'
	if (s > 0) return 'text-yellow-400'
	return 'text-red-400'
}

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

function SortHeader({
	label,
	field,
	sortBy,
	sortDir,
	onToggle,
}: {
	label: string
	field: SortField
	sortBy: SortField | null
	sortDir: SortDir
	onToggle: (field: SortField) => void
}) {
	const active = sortBy === field
	const Icon = !active ? ChevronsUpDown : sortDir === 'asc' ? ChevronUp : ChevronDown
	return (
		<button
			type="button"
			onClick={() => onToggle(field)}
			className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
				active ? 'text-foreground' : ''
			}`}
			aria-label={`Sort by ${label}`}
		>
			<span>{label}</span>
			<Icon className={`h-3.5 w-3.5 ${active ? 'opacity-100' : 'opacity-50'}`} />
		</button>
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
	const sec = moon.securityStatus !== null ? Math.max(0, parseFloat(moon.securityStatus)).toFixed(1) : '—'
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
			<TableCell className={`font-mono text-xs ${secColor(moon.securityStatus)}`}>{sec}</TableCell>
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

	const [selectedRarities, setSelectedRarities] = useState<OreRarity[]>([])
	const [regionFilter, setRegionFilter] = useState<string>('all')
	const [constellationFilter, setConstellationFilter] = useState<string>('all')
	const [search, setSearch] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(50)
	const [sortBy, setSortBy] = useState<SortField | null>(null)
	const [sortDir, setSortDir] = useState<SortDir>('desc')
	const [collapsedConstellations, setCollapsedConstellations] = useState<Set<string>>(new Set())

	const toggleRarity = (rarity: OreRarity) => {
		setSelectedRarities((prev) =>
			prev.includes(rarity) ? prev.filter((r) => r !== rarity) : [...prev, rarity]
		)
		setPage(1)
	}

	const toggleSort = (field: SortField) => {
		if (sortBy !== field) {
			setSortBy(field)
			setSortDir('desc')
		} else if (sortDir === 'desc') {
			setSortDir('asc')
		} else {
			setSortBy(null)
			setSortDir('desc')
		}
		setPage(1)
	}

	const { data, isLoading, isFetching, error } = useScannedMoons({
		page,
		pageSize,
		regionId: regionFilter,
		constellationId: constellationFilter,
		rarities: selectedRarities,
		search,
		sortBy: sortBy ?? undefined,
		sortDir: sortBy ? sortDir : undefined,
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

	const constellationOptions = useMemo(() => {
		const constellations = data?.constellations ?? []
		return [
			{ value: 'all', label: 'All Constellations' },
			...constellations.map((c) => ({ value: c.constellationId, label: c.constellationName })),
		]
	}, [data?.constellations])

	const groupedItems = useMemo(() => {
		const items = data?.items ?? []
		const groups = new Map<string, { constellationId: string; constellationName: string; moons: ScannedMoonEntry[] }>()
		for (const moon of items) {
			const key = moon.constellationId || '_unknown'
			let group = groups.get(key)
			if (!group) {
				group = {
					constellationId: moon.constellationId,
					constellationName: moon.constellationName || 'Unknown Constellation',
					moons: [],
				}
				groups.set(key, group)
			}
			group.moons.push(moon)
		}
		return [...groups.values()]
	}, [data?.items])

	const toggleConstellationCollapse = (id: string) => {
		setCollapsedConstellations((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const totalCount = data?.total ?? 0
	const hasPagination = Math.ceil(totalCount / pageSize) > 1
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
					{/* Rarity multi-select chips */}
					<div className="flex items-center gap-1 rounded-md border bg-card p-1">
						<button
							type="button"
							onClick={() => {
								setSelectedRarities([])
								setPage(1)
							}}
							className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
								selectedRarities.length === 0
									? 'bg-muted text-foreground'
									: 'text-muted-foreground hover:text-foreground'
							}`}
						>
							All
						</button>
						{RARITY_VALUES.map((rarity) => {
							const active = selectedRarities.includes(rarity)
							return (
								<button
									key={rarity}
									type="button"
									onClick={() => toggleRarity(rarity)}
									aria-pressed={active}
									className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
										active ? 'text-white' : 'hover:bg-muted/50'
									}`}
									style={{
										color: active ? '#fff' : RARITY_COLORS[rarity],
										backgroundColor: active ? RARITY_COLORS[rarity] : undefined,
									}}
								>
									{rarity}
								</button>
							)
						})}
					</div>

				{/* Region dropdown */}
					<Select
						value={regionFilter}
						onValueChange={(value) => {
							setRegionFilter(value)
							setConstellationFilter('all')
							setPage(1)
						}}
						options={regionOptions}
						searchable
						placeholder="Filter region..."
						className="w-56"
						inputClassName="h-9"
					/>

				{/* Constellation dropdown */}
					<Select
						value={constellationFilter}
						onValueChange={(value) => {
							setConstellationFilter(value)
							setPage(1)
						}}
						options={constellationOptions}
						searchable
						placeholder="Filter constellation..."
						className="w-56"
						inputClassName="h-9"
						disabled={constellationOptions.length <= 1}
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
					<span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
						{isFetching && (
							<span
								className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary"
								aria-label="Updating"
							/>
						)}
						{data.items.length} shown • {data.total} total
					</span>
				)}
			</div>

			<Card className="mt-4 overflow-hidden">
				{hasPagination && <div className="border-b p-4">{renderPaginationControls()}</div>}
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Moon</TableHead>
							<TableHead>System</TableHead>
							<TableHead>Region</TableHead>
							<TableHead>Sec</TableHead>
							<TableHead>Rarity</TableHead>
							<TableHead className="text-right">
								<SortHeader
									label="Metenox 30d"
									field="metenox"
									sortBy={sortBy}
									sortDir={sortDir}
									onToggle={toggleSort}
								/>
							</TableHead>
							<TableHead className="text-right">
								<SortHeader
									label="Refinery 30d"
									field="tatara"
									sortBy={sortBy}
									sortDir={sortDir}
									onToggle={toggleSort}
								/>
							</TableHead>
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
							: groupedItems.map((group) => {
									const collapsed = collapsedConstellations.has(group.constellationId)
									return (
										<Fragment key={group.constellationId || '_unknown'}>
											<TableRow
												className="bg-muted/30 hover:bg-muted/40 cursor-pointer"
												onClick={() => toggleConstellationCollapse(group.constellationId)}
											>
												<TableCell colSpan={7} className="py-2">
													<div className="flex items-center gap-2 text-sm font-medium">
														{collapsed ? (
															<ChevronRight className="h-4 w-4 text-muted-foreground" />
														) : (
															<ChevronDown className="h-4 w-4 text-muted-foreground" />
														)}
														<span>{group.constellationName}</span>
														<span className="text-xs font-normal text-muted-foreground">
															{group.moons.length} moon{group.moons.length === 1 ? '' : 's'}
														</span>
													</div>
												</TableCell>
											</TableRow>
											{!collapsed &&
												group.moons.map((moon) => <MoonRow key={moon.moonId} moon={moon} />)}
										</Fragment>
									)
								})}
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
