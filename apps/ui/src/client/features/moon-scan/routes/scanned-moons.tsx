import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { HoverPopover } from '@/components/ui/hover-popover'
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
import { TableRefreshFrame } from '@/components/table-refresh-frame'
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatISK } from '@/lib/format-utils'
import toast from '@/lib/toast'

import { RARITY_COLORS } from '../ore-rarities'
import {
	downloadScannedMoonsExport,
	getScannedMoonsExportStatus,
	requestScannedMoonsExport,
} from '../api'
import { useScannedMoons, useMoonRegions } from '../hooks'
import { useMoonScanPermissions } from '../permissions'
import { parseSecurityStatus, securityStatusTextClass } from '../security-status'

import type { OreRarity, ScannedMoonEntry } from '../types'

const RARITY_VALUES: readonly OreRarity[] = ['R4', 'R8', 'R16', 'R32', 'R64']
type SortBy =
	| 'moonName'
	| 'solarSystemName'
	| 'regionName'
	| 'securityStatus'
	| 'highestRarity'
	| 'metenoxProfit'
	| 'tataraProfit'
type SortDir = 'asc' | 'desc'
type ViewMode = 'grouped' | 'ungrouped'

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
	usePageTitle('Scanned Moons')

	const { canView } = useMoonScanPermissions()

	const [selectedRarities, setSelectedRarities] = useState<OreRarity[]>([])
	const [regionFilter, setRegionFilter] = useState<string>('all')
	const [constellationFilter, setConstellationFilter] = useState<string>('all')
	const [search, setSearch] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(50)
	const [sortBy, setSortBy] = useState<SortBy>('moonName')
	const [sortDir, setSortDir] = useState<SortDir>('asc')
	const [viewMode, setViewMode] = useState<ViewMode>('grouped')
	const [collapsedConstellations, setCollapsedConstellations] = useState<Set<string>>(new Set())
	const [pendingExport, setPendingExport] = useState<{ workflowInstanceId: string; fileName: string } | null>(null)
	const [isExporting, setIsExporting] = useState(false)
	const debouncedSearch = useDebounce(search, 400)

	const exportStatusQuery = useQuery({
		queryKey: ['moon-scan', 'verified-moons', 'export-status', pendingExport?.workflowInstanceId ?? null],
		queryFn: () => getScannedMoonsExportStatus(pendingExport!.workflowInstanceId),
		enabled: Boolean(pendingExport?.workflowInstanceId),
		refetchInterval: (query) => {
			const status = query.state.data?.status
			return status === 'queued' || status === 'running' ? 5000 : false
		},
		refetchOnWindowFocus: false,
	})
	const exportStatus = exportStatusQuery.data?.status
	const isExportPolling =
		Boolean(pendingExport) && (exportStatus === undefined || exportStatus === 'queued' || exportStatus === 'running')
	const isExportBusy = isExporting || isExportPolling

	useEffect(() => {
		if (!pendingExport) return
		if (!exportStatusQuery.data) return
		if (exportStatusQuery.data.status === 'completed') {
			void (async () => {
				try {
					await downloadScannedMoonsExport(pendingExport.workflowInstanceId, pendingExport.fileName)
					toast.success('Scanned moons export ready')
				} catch (error) {
					const messageText =
						error instanceof Error ? error.message : 'Failed to download scanned moons export'
					toast.error(messageText)
					console.error('[MoonScan] Failed to download scanned moons export', error)
				} finally {
					setPendingExport(null)
					setIsExporting(false)
				}
			})()
			return
		}
		if (exportStatusQuery.data.status === 'failed' || exportStatusQuery.data.status === 'unknown') {
			toast.error('Scanned moons export failed')
			setPendingExport(null)
			setIsExporting(false)
		}
	}, [exportStatusQuery.data, pendingExport])

	const toggleRarity = (rarity: OreRarity) => {
		setSelectedRarities((prev) =>
			prev.includes(rarity) ? prev.filter((r) => r !== rarity) : [...prev, rarity]
		)
		setPage(1)
	}

	const { data, isLoading, isFetching, error } = useScannedMoons({
		page,
		pageSize,
		regionId: regionFilter,
		constellationId: constellationFilter,
		rarities: selectedRarities,
		search: debouncedSearch,
		sortBy,
		sortDir,
	}, canView)
	const { data: regionsData } = useMoonRegions(canView)

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
	const hasExportScope = regionFilter !== 'all' || constellationFilter !== 'all'
	const canExportCsv = canView && hasExportScope
	const exportHelpMessage = 'Select a region or constellation to export this scope.'
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
	const handleExport = useCallback(async () => {
		if (!canExportCsv || isExporting) {
			return
		}

		setIsExporting(true)
		try {
			const exportResult = await requestScannedMoonsExport({
				regionId: regionFilter,
				constellationId: constellationFilter,
				rarities: selectedRarities,
				search,
				sortBy,
				sortDir,
			})
			setPendingExport({
				workflowInstanceId: exportResult.workflowInstanceId,
				fileName: exportResult.fileName,
			})
		} catch (error) {
			const messageText = error instanceof Error ? error.message : 'Failed to export scanned moons'
			toast.error(messageText)
			console.error('[MoonScan] Failed to export scanned moons', error)
			setIsExporting(false)
		}
	}, [
		canExportCsv,
		constellationFilter,
		isExporting,
		regionFilter,
		search,
		selectedRarities,
		sortBy,
		sortDir,
	])

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
				action={
					<div className="flex items-center gap-3">
						{isExportPolling && (
							<span className="text-xs text-muted-foreground">Waiting for export to generate...</span>
						)}
						{!canExportCsv && !isExportBusy ? (
							<HoverPopover
								align="end"
								side="bottom"
								className="w-72 border border-border bg-popover p-3 text-popover-foreground shadow-lg"
								trigger={
									<span className="inline-block cursor-help">
										<Button type="button" variant="ghost" disabled>
											Export CSV
										</Button>
									</span>
								}
							>
								<div className="text-sm font-medium">Export scope required</div>
								<div className="text-sm text-muted-foreground">{exportHelpMessage}</div>
							</HoverPopover>
						) : (
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									void handleExport()
								}}
								disabled={!canExportCsv || isExportBusy}
								loading={isExportBusy}
								loadingText={isExporting ? 'Exporting…' : 'Generating…'}
							>
								Export CSV
							</Button>
						)}
					</div>
				}
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

				{/* Grouped / ungrouped view toggle */}
				<div className="flex items-center gap-1 rounded-md border bg-card p-1">
					{(['grouped', 'ungrouped'] as const).map((mode) => (
						<button
							key={mode}
							type="button"
							onClick={() => setViewMode(mode)}
							aria-pressed={viewMode === mode}
							className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
								viewMode === mode
									? 'bg-muted text-foreground'
									: 'text-muted-foreground hover:text-foreground'
							}`}
						>
							{mode}
						</button>
					))}
				</div>

				{!isLoading && data && (
					<span className="flex items-center gap-2 text-xs text-muted-foreground">
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
				<TableRefreshFrame
					isRefreshing={Boolean(data) && isFetching}
					refreshMessage="Refreshing scanned moons..."
				>
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
								: viewMode === 'ungrouped'
									? (data?.items ?? []).map((moon) => <MoonRow key={moon.moonId} moon={moon} />)
									: groupedItems.map((group) => {
										const collapsed = collapsedConstellations.has(group.constellationId)
										return (
											<Fragment key={group.constellationId || '_unknown'}>
												<TableRow
													className="bg-muted/30 cursor-pointer hover:bg-muted/40"
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
				</TableRefreshFrame>
				{hasPagination && <div className="border-t p-4">{renderPaginationControls()}</div>}
			</Card>
		</Container>
	)
}
