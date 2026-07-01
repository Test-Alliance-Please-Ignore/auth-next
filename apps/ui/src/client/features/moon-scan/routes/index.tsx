import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
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
import { usePageTitle } from '@/hooks/usePageTitle'

import { useMoonRegions } from '../hooks'
import { useMoonScanPermissions } from '../permissions'
import type { RegionSummary } from '../types'

// Dotlan-exact region center coordinates for the universe map.
// Excludes inaccessible Jove regions (10000004 UUA-F4, 10000017 J7HZ-F, 10000019 A821-A)
// and Pochven (10000070) which is not k-space moon mining territory.
const DOTLAN_COORDS: Record<string, [number, number]> = {
	'10000001': [441.5, 371.5], '10000002': [422.5, 214.5], '10000003': [434.5, 136.5],
	'10000005': [602.5, 474.5], '10000006': [556.5, 432.5], '10000007': [676.5, 298.5],
	'10000008': [570.5, 382.5], '10000009': [646.5, 396.5], '10000010': [368.5, 106.5],
	'10000011': [562.5, 328.5], '10000012': [470.5, 416.5], '10000013': [587.5, 185.5],
	'10000014': [382.5, 486.5], '10000015': [378.5, 66.5],  '10000016': [367.5, 156.5],
	'10000018': [644.5, 217.5], '10000020': [249.5, 419.5], '10000021': [676.5, 160.5],
	'10000022': [309.5, 511.5], '10000023': [299.5, 112.5], '10000025': [464.5, 464.5],
	'10000027': [530.5, 211.5], '10000028': [498.5, 318.5], '10000029': [472.5, 178.5],
	'10000030': [438.5, 309.5], '10000031': [404.5, 530.5], '10000032': [288.5, 269.5],
	'10000033': [352.5, 213.5], '10000034': [526.5, 149.5], '10000035': [281.5, 34.5],
	'10000036': [347.5, 385.5], '10000037': [225.5, 262.5], '10000038': [347.5, 340.5],
	'10000039': [284.5, 552.5], '10000040': [644.5, 111.5], '10000041': [121.5, 188.5],
	'10000042': [465.5, 268.5], '10000043': [278.5, 374.5], '10000044': [113.5, 281.5],
	'10000045': [415.5, 18.5],  '10000046': [275.5, 72.5],  '10000047': [347.5, 440.5],
	'10000048': [208.5, 168.5], '10000049': [149.5, 426.5], '10000050': [189.5, 482.5],
	'10000051': [172.5, 101.5], '10000052': [219.5, 352.5], '10000053': [679.5, 74.5],
	'10000054': [93.5, 361.5],  '10000055': [341.5, 15.5],  '10000056': [398.5, 579.5],
	'10000057': [76.5, 123.5],  '10000058': [28.5, 233.5],  '10000059': [219.5, 575.5],
	'10000060': [70.5, 462.5],  '10000061': [479.5, 510.5], '10000062': [469.5, 560.5],
	'10000063': [96.5, 542.5],  '10000064': [220.5, 206.5], '10000065': [172.5, 384.5],
	'10000066': [582.5, 124.5], '10000067': [162.5, 329.5], '10000068': [160.5, 240.5],
	'10000069': [310.5, 174.5],
}

const RW = 54
const RH = 16
const MAP_COLORS = {
	verifiedFill: '#1a3320',
	verifiedStroke: '#28a745',
	partialFill: '#332a10',
	partialStroke: '#c89b20',
	hasMoonFill: '#1e2830',
	hasMoonStroke: '#4a5a6a',
	emptyFill: '#151c24',
	emptyStroke: '#2a3644',
	text: '#c8d4e0',
	connection: '#2a3a4a',
	background: '#0b1218',
	tooltipBackground: 'rgba(14,22,32,0.95)',
	tooltipBorder: '#3d9ae8',
	tooltipText: '#d0d8e0',
	tooltipMuted: '#6b7c8f',
} as const

function regionFill(moonCount: number, verifiedCount: number, scannedCount: number): string {
	if (moonCount === 0) return MAP_COLORS.emptyFill
	if (verifiedCount === moonCount) return MAP_COLORS.verifiedFill
	if (verifiedCount > 0 || scannedCount > 0) return MAP_COLORS.partialFill
	return MAP_COLORS.hasMoonFill
}

function regionStroke(moonCount: number, verifiedCount: number, scannedCount: number): string {
	if (moonCount === 0) return MAP_COLORS.emptyStroke
	if (verifiedCount === moonCount) return MAP_COLORS.verifiedStroke
	if (verifiedCount > 0 || scannedCount > 0) return MAP_COLORS.partialStroke
	return MAP_COLORS.hasMoonStroke
}

interface TooltipState {
	region: RegionSummary
}

interface RegionNodeProps {
	region: RegionSummary
	dimmed?: boolean
	onHover: (region: RegionSummary | null) => void
	onClick: () => void
}

function RegionNode({ region, dimmed = false, onHover, onClick }: RegionNodeProps) {
	const pos = DOTLAN_COORDS[region.regionId]
	if (!pos) return null
	const [cx, cy] = pos

	const fill = regionFill(region.moonCount, region.verifiedCount, region.scannedCount)
	const stroke = regionStroke(region.moonCount, region.verifiedCount, region.scannedCount)
	const textFill = MAP_COLORS.text
	const clipId = `clip-${region.regionId}`

	return (
		<g
			opacity={dimmed ? 0.2 : 1}
			style={{ cursor: 'pointer' }}
			onClick={onClick}
			onMouseEnter={() => onHover(region)}
			onMouseLeave={() => onHover(null)}
		>
			<clipPath id={clipId}>
				<rect x={cx - RW / 2 + 2} y={cy - RH / 2} width={RW - 4} height={RH} />
			</clipPath>
			<rect
				x={cx - RW / 2}
				y={cy - RH / 2}
				width={RW}
				height={RH}
				rx={8}
				ry={8}
				fill={fill}
				stroke={stroke}
				strokeWidth={1}
			/>
			<text
				x={cx}
				y={cy}
				textAnchor="middle"
				dominantBaseline="central"
				fontSize={7}
				fontFamily="Arial, Helvetica, sans-serif"
				fill={textFill}
				clipPath={`url(#${clipId})`}
				style={{ pointerEvents: 'none' }}
			>
				{region.regionName}
			</text>
		</g>
	)
}

function AccessTile({
	to,
	title,
	description,
}: {
	to: string
	title: string
	description: string
}) {
	return (
		<Link
			to={to}
			className="rounded-md border border-border/70 bg-background/60 p-4 transition-colors hover:border-primary/60 hover:bg-accent/30"
		>
			<div className="text-sm font-medium">{title}</div>
			<div className="mt-1 text-xs text-muted-foreground">{description}</div>
		</Link>
	)
}

export default function MoonScanIndex() {
	usePageTitle('Moon Scanning')

	const { canView, canSubmit, canValidate, canAdmin, canAccessMoonScan } = useMoonScanPermissions()
	const navigate = useNavigate()
	const mapWrapRef = useRef<HTMLDivElement>(null)

	const { data, isLoading, error } = useMoonRegions(canView)
	const regions = data?.regions
	const connections = data?.connections ?? []

	const [tooltip, setTooltip] = useState<TooltipState | null>(null)
	const [tooltipPx, setTooltipPx] = useState<{ x: number; y: number } | null>(null)
	const [regionSearch, setRegionSearch] = useState('')

	if (!canAccessMoonScan) {
		return (
			<Container>
				<PageHeader title="Moon Scanning" description="You do not have permission to view moon data." />
			</Container>
		)
	}

	const accessTiles: Array<{ to: string; title: string; description: string }> = []
	if (canSubmit) {
		accessTiles.push(
			{ to: '/moon-scan/submit', title: 'Submit Scan', description: 'Paste and submit moon scan results.' },
			{ to: '/moon-scan/my-scans', title: 'My Scans', description: 'Review scans you have submitted.' },
			{ to: '/moon-scan/leaderboard', title: 'Leaderboard', description: 'View verified scan contributor rankings.' }
		)
	}
	if (canValidate) {
		accessTiles.push({
			to: '/moon-scan/queue',
			title: 'Validation Queue',
			description: 'Review and approve pending moon scans.',
		})
	}
	if (canView) {
		accessTiles.push(
			{ to: '/moon-scan', title: 'Regions', description: 'Browse k-space regions and coverage.' },
			{ to: '/moon-scan/scanned', title: 'Scanned Moons', description: 'Inspect verified moon compositions.' }
		)
	}
	if (canAdmin) {
		accessTiles.push({
			to: '/moon-scan/settings',
			title: 'Configuration',
			description: 'Manage moon scan extraction defaults and profiles.',
		})
	}

	if (!canView) {
		return (
			<Container>
				<div className="mb-4">
					<PageHeader title="Moon Scanning" description="Choose one of the available moon scan tools." />
				</div>
				<Card className="mt-section">
					<CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
						{accessTiles.map((tile) => (
							<AccessTile key={tile.to} {...tile} />
						))}
					</CardContent>
				</Card>
			</Container>
		)
	}

	const sorted = [...(regions ?? [])].sort((a, b) => a.regionName.localeCompare(b.regionName))
	const normalizedRegionSearch = regionSearch.trim().toLowerCase()
	const filteredRegions = normalizedRegionSearch
		? sorted.filter((r) => r.regionName.toLowerCase().includes(normalizedRegionSearch))
		: sorted
	const highlightedRegionIds = new Set(filteredRegions.map((r) => r.regionId))
	const hasActiveRegionFilter = normalizedRegionSearch.length > 0

	function handleNodeHover(region: RegionSummary | null) {
		setTooltip(region ? { region } : null)
	}

	function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
		if (!mapWrapRef.current) return
		const br = mapWrapRef.current.getBoundingClientRect()
		const x = Math.min(e.clientX - br.left + 14, br.width - 220)
		const y = e.clientY - br.top - 10
		setTooltipPx({ x, y })
	}

	return (
		<Container>
			<div className="mb-4">
				<PageHeader
					title="Moon Scanning"
				/>
			</div>

			{error && (
				<div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					Failed to load regions
				</div>
			)}

			{/* Universe SVG Map */}
			{isLoading ? (
				<Skeleton className="h-[500px] w-full rounded-md" />
			) : (
				<Card
						ref={mapWrapRef}
						className="relative"
						style={{ background: MAP_COLORS.background }}
						onMouseMove={handleMouseMove}
					onMouseLeave={() => setTooltip(null)}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="-10 -10 728 618"
						className="block w-full"
						preserveAspectRatio="xMidYMid meet"
						style={{ maxHeight: '70vh' }}
					>
						{/* Inter-region jump connections */}
						{connections.map((conn, i) => {
							const fromPos = DOTLAN_COORDS[conn.fromRegionId]
							const toPos = DOTLAN_COORDS[conn.toRegionId]
							if (!fromPos || !toPos) return null
							return (
								<line
									key={i}
									x1={fromPos[0]}
									y1={fromPos[1]}
										x2={toPos[0]}
										y2={toPos[1]}
										stroke={MAP_COLORS.connection}
										strokeWidth={1}
									opacity={0.7}
								/>
							)
						})}

						{/* Region nodes */}
						{(regions ?? []).map((r) => (
							<RegionNode
								key={r.regionId}
								region={r}
								dimmed={hasActiveRegionFilter && !highlightedRegionIds.has(r.regionId)}
								onHover={handleNodeHover}
								onClick={() => navigate(`/moon-scan/region/${r.regionId}`)}
							/>
						))}
					</svg>

					{/* Tooltip */}
					{tooltip && tooltipPx && (
						<div
								style={{
									position: 'absolute',
									left: tooltipPx.x,
									top: tooltipPx.y,
									background: MAP_COLORS.tooltipBackground,
									border: `1px solid ${MAP_COLORS.tooltipBorder}`,
									color: MAP_COLORS.tooltipText,
									padding: '6px 10px',
								borderRadius: 4,
								fontSize: '0.8rem',
								pointerEvents: 'none',
								whiteSpace: 'nowrap',
								zIndex: 10,
							}}
							>
								<span style={{ color: MAP_COLORS.tooltipBorder, fontWeight: 600 }}>{tooltip.region.regionName}</span>
								<br />
								<span style={{ color: MAP_COLORS.tooltipMuted }}>Systems: </span>{tooltip.region.systemCount}
								{'  '}
								<span style={{ color: MAP_COLORS.tooltipMuted }}>Moons: </span>{tooltip.region.moonCount}
								{tooltip.region.moonCount > 0 && (
									<>
										<br />
										<span style={{ color: MAP_COLORS.tooltipMuted }}>Verified: </span>
										{tooltip.region.verifiedCount}
										{' '}({Math.round(tooltip.region.verifiedCount / tooltip.region.moonCount * 100)}%)
								</>
							)}
						</div>
					)}
				</Card>
			)}

			{/* Legend */}
				<div className="mt-2 mb-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
					<span className="flex items-center gap-1.5">
						<span className="inline-block h-3 w-8 rounded" style={{ background: MAP_COLORS.verifiedFill, border: `1px solid ${MAP_COLORS.verifiedStroke}` }} />
						100% Verified
					</span>
					<span className="flex items-center gap-1.5">
						<span className="inline-block h-3 w-8 rounded" style={{ background: MAP_COLORS.partialFill, border: `1px solid ${MAP_COLORS.partialStroke}` }} />
						Partially Scanned
					</span>
					<span className="flex items-center gap-1.5">
						<span className="inline-block h-3 w-8 rounded" style={{ background: MAP_COLORS.hasMoonFill, border: `1px solid ${MAP_COLORS.hasMoonStroke}` }} />
						Has Moons
					</span>
					<span className="flex items-center gap-1.5">
						<span className="inline-block h-3 w-8 rounded" style={{ background: MAP_COLORS.emptyFill, border: `1px solid ${MAP_COLORS.emptyStroke}` }} />
						No Moon Data
					</span>
				<span className="text-muted-foreground/60">Click region to open</span>
			</div>

				{/* Regions Table */}
				<Card>
					<div className="border-b px-4 py-2.5">
						<div className="flex items-center justify-between gap-2">
							<div className="text-sm font-medium">Regions</div>
							<Input
								value={regionSearch}
								onChange={(e) => setRegionSearch(e.target.value)}
								placeholder="Filter regions..."
								className="h-8 w-full sm:w-64"
							/>
						</div>
					</div>
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Region</TableHead>
									<TableHead className="text-right">Systems</TableHead>
									<TableHead className="text-right">Moons</TableHead>
									<TableHead className="text-right">Verified</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{isLoading
									? Array.from({ length: 10 }).map((_, i) => (
											<TableRow key={i}>
												<TableCell colSpan={4}>
													<Skeleton className="h-4 w-32" />
												</TableCell>
											</TableRow>
										))
									: filteredRegions.map((r) => (
											<TableRow
												key={r.regionId}
												className="cursor-pointer hover:bg-accent/50 transition-colors"
												onClick={() => navigate(`/moon-scan/region/${r.regionId}`)}
											>
												<TableCell className="font-medium">{r.regionName}</TableCell>
												<TableCell className="text-right tabular-nums text-muted-foreground">{r.systemCount}</TableCell>
												<TableCell className="text-right tabular-nums">{r.moonCount || '—'}</TableCell>
												<TableCell className="text-right tabular-nums">
													{r.moonCount > 0
														? `${r.verifiedCount} (${Math.round(r.verifiedCount / r.moonCount * 100)}%)`
														: '—'}
												</TableCell>
											</TableRow>
										))}
								{!isLoading && filteredRegions.length === 0 && (
									<TableRow>
										<TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
											No regions match the current filter.
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>
				</Card>
			</Container>
	)
}
