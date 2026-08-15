import { ArrowLeft } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router'

import { MoonProfitabilityTable } from '@/components/moon-profitability-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
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
import { typeIconUrl } from '@/lib/eve-images'
import { formatISK } from '@/lib/format-utils'

import { ScanStatusBadge } from '../components/ScanStatusBadge'
import { formatMoonScanDateTime } from '../date'
import { useMoonDetail } from '../hooks'
import { getOreRarity, RARITY_COLORS } from '../ore-rarities'
import { useMoonScanPermissions } from '../permissions'

import type { OreRefineProduct, OreWithProfitability, StructureProfitability } from '../types'

function RarityBadge({ rarity }: { rarity: string }) {
	const color = RARITY_COLORS[rarity as keyof typeof RARITY_COLORS] ?? '#555'
	return (
		<span
			className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold text-white"
			style={{ backgroundColor: color }}
		>
			{rarity}
		</span>
	)
}

function formatVolumeM3(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return '—'
	return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} m3`
}

function OreCompositionTable({ ores }: { ores: OreWithProfitability[] }) {
	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Ore</TableHead>
						<TableHead>Rarity</TableHead>
						<TableHead>Percentage</TableHead>
						<TableHead className="text-right">Raw ore volume (m3)</TableHead>
						<TableHead>Refines To (per 100)</TableHead>
						<TableHead className="text-right">Batch volume (m3)</TableHead>
						<TableHead className="text-right">Total (refinery m3)</TableHead>
						<TableHead className="text-right">Jita Sell</TableHead>
						<TableHead className="text-right">Per 100 ore</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{ores.map((ore) => {
						const rarity = getOreRarity(ore.oreTypeId)
						const color = rarity ? RARITY_COLORS[rarity] : '#555'
						const rows = ore.refinesTo.filter((r) => r.quantity > 0)
						return rows.map((product, idx) => {
							const batchQty = product.batchQty
							const per100Value = batchQty * parseFloat(product.unitSellPrice)
							return (
								<TableRow key={`${ore.oreTypeId}-${product.materialTypeId}`}>
									{idx === 0 && (
										<>
											<TableCell rowSpan={rows.length} className="align-top">
												<div className="flex items-center gap-2">
													<img
														src={typeIconUrl(ore.oreTypeId, 32)}
														alt=""
														className="h-6 w-6 rounded"
														loading="lazy"
													/>
													<span
														className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-white"
														style={{ backgroundColor: color }}
													>
														{ore.oreName}
													</span>
												</div>
											</TableCell>
											<TableCell rowSpan={rows.length} className="align-top whitespace-nowrap">
												{rarity ? <RarityBadge rarity={rarity} /> : '—'}
											</TableCell>
											<TableCell
												rowSpan={rows.length}
												className="align-top whitespace-nowrap tabular-nums"
											>
												{(parseFloat(ore.quantity) * 100).toFixed(2)}%
											</TableCell>
											<TableCell
												rowSpan={rows.length}
												className="align-top whitespace-nowrap text-right tabular-nums text-xs"
											>
												{formatVolumeM3(ore.oreVolumeM3)}
											</TableCell>
										</>
									)}
									<TableCell>
										<MaterialCell product={product} batchQty={batchQty} />
									</TableCell>
									<TableCell className="text-right tabular-nums text-xs">
										{formatVolumeM3(product.volumePer100M3)}
									</TableCell>
									<TableCell className="text-right tabular-nums text-xs">
										{formatVolumeM3(product.volumeM3)}
									</TableCell>
									<TableCell className="text-right tabular-nums text-xs">
										{formatISK(product.unitSellPrice, { showDecimals: false })}
									</TableCell>
									<TableCell className="text-right tabular-nums text-xs">
										{formatISK(per100Value, { showDecimals: false })}
									</TableCell>
								</TableRow>
							)
						})
					})}
				</TableBody>
			</Table>
		</div>
	)
}

function MaterialCell({ product, batchQty }: { product: OreRefineProduct; batchQty: number }) {
	const rarity = getOreRarity(product.materialTypeId)
	return (
		<span className="inline-flex items-center gap-2 text-xs">
			<span>
				{rarity && <RarityBadge rarity={rarity} />}
				{rarity && ' '}
				<img
					src={typeIconUrl(product.materialTypeId, 32)}
					alt=""
					className="inline-block h-5 w-5 rounded align-middle"
					loading="lazy"
				/>{' '}
				<span className="font-semibold text-foreground">{product.materialName}</span>{' '}
				<span className="text-muted-foreground">×{batchQty.toLocaleString()}</span>
			</span>
		</span>
	)
}

function ProfitabilityCard({
	structures,
	updatedAt,
	pricingSnapshotDate,
}: {
	structures: StructureProfitability[]
	updatedAt: string
	pricingSnapshotDate: string | null
}) {
	const ORDER = ['metenox', 'tatara']
	const visible = ORDER.map((id) => structures.find((s) => s.structureType === id)).filter(
		(s): s is StructureProfitability => s !== undefined
	)

	return (
		<div className="rounded-md border bg-card">
			<div className="border-b px-4 py-3 text-sm font-semibold">Profitability</div>
			<div className="grid grid-cols-1 gap-0 sm:grid-cols-2 sm:divide-x">
				{visible.map((s) => (
					<MoonProfitabilityTable key={s.structureType} structure={s} />
				))}
			</div>
			<div className="border-t px-4 py-2 text-xs text-muted-foreground">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span>Calculated:</span>
					<EveTimeDisplay dateStr={updatedAt} />
				</div>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span>Pricing Source: Global Daily Average</span>
					<span aria-hidden="true">•</span>
					<span className="flex items-center gap-1">
						Snapshot:
						{pricingSnapshotDate ? (
							<EveTimeDisplay dateStr={`${pricingSnapshotDate}T00:00:00Z`} format="date" />
						) : (
							<span>Unavailable</span>
						)}
					</span>
				</div>
			</div>
		</div>
	)
}

export default function MoonPage() {
	const { moonId } = useParams<{ moonId: string }>()
	const location = useLocation()
	const navigationState =
		location.state && typeof location.state === 'object'
			? (location.state as {
					from?: unknown
					systemFrom?: unknown
					moonName?: unknown
					solarSystemName?: unknown
				})
			: null
	const immediateMoonName =
		typeof navigationState?.moonName === 'string' ? navigationState.moonName : null
	const immediateSystemName =
		typeof navigationState?.solarSystemName === 'string' ? navigationState.solarSystemName : null
	const { canView } = useMoonScanPermissions()

	const { data: detail, isLoading, error } = useMoonDetail(moonId!, canView)
	const resolvedMoonName = detail?.moon?.moonName ?? immediateMoonName
	usePageTitle(resolvedMoonName ? `${resolvedMoonName} — Moon` : 'Moon Detail')

	if (!canView) {
		return (
			<Container>
				<div className="mt-section rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
					You do not have permission to view moon data.
				</div>
			</Container>
		)
	}

	const moon = detail?.moon
	const composition = detail?.composition
	const profitability = detail?.profitability
	const backTo =
		typeof navigationState?.from === 'string' && navigationState.from.startsWith('/moon-scan')
			? navigationState.from
			: moon?.solarSystemId
				? `/moon-scan/system/${moon.solarSystemId}`
				: '/moon-scan'
	const backLabel = backTo.startsWith('/moon-scan/scanned')
		? 'Back to Scanned Moons'
		: backTo.startsWith('/moon-scan/system/')
			? 'Back to System'
			: 'Back to Regions'
	const systemNavigationState = backTo.startsWith('/moon-scan/system/')
		? {
				from:
					typeof navigationState?.systemFrom === 'string'
						? navigationState.systemFrom
						: '/moon-scan',
				systemName: immediateSystemName,
			}
		: undefined

	return (
		<Container>
			<PageHeader
				title={moon?.moonName ?? immediateMoonName ?? 'Moon'}
				description={moon ? `Moon ID: ${moon.moonId}` : undefined}
				action={
					<div className="flex flex-col items-end gap-2">
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Link to="/moon-scan" className="hover:underline">
								Moons
							</Link>
							{moon?.solarSystemId && (
								<>
									<span>/</span>
									<Link
										to={`/moon-scan/system/${moon.solarSystemId}`}
										state={systemNavigationState}
										className="hover:underline"
									>
										{moon.solarSystemName || immediateSystemName || 'System'}
									</Link>
								</>
							)}
							<span>/</span>
							<span>{moon?.moonName ?? immediateMoonName ?? 'Moon'}</span>
						</div>
						<Button variant="ghost" size="sm" asChild>
							<Link to={backTo} state={systemNavigationState}>
								<ArrowLeft className="mr-2 h-4 w-4" />
								{backLabel}
							</Link>
						</Button>
					</div>
				}
			/>

			<div className="mb-6 -mt-3">
				<div className="flex items-center gap-3 flex-wrap">
					{composition ? (
						<Badge className="bg-green-500/20 text-green-400 border-green-500/30">verified</Badge>
					) : !isLoading ? (
						<Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
							unverified
						</Badge>
					) : null}
				</div>
			</div>

			{error && (
				<div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					Failed to load moon data
				</div>
			)}

			{isLoading && (
				<div className="space-y-4">
					<Skeleton className="h-64 w-full rounded-md" />
					<Skeleton className="h-48 w-full rounded-md" />
				</div>
			)}

			{!isLoading && !composition && (
				<div className="mb-6 rounded-md border border-dashed bg-card/50 p-6 text-center text-sm text-muted-foreground">
					No verified composition yet.
				</div>
			)}

			{/* Verified composition table */}
			{!isLoading && profitability && composition && (
				<div className="mb-6 rounded-md border bg-card">
					<div className="border-b px-4 py-3 flex items-center justify-between">
						<span className="text-sm font-semibold text-green-400">✓ Verified Composition</span>
					</div>
					<OreCompositionTable ores={profitability.ores} />
					<div className="border-t px-4 py-2 text-xs text-muted-foreground">
						Verified
						{composition.verifiedBy
							? ` by ${composition.verifiedByName ?? composition.verifiedBy}`
							: ''}{' '}
						on {new Date(composition.verifiedAt).toISOString().slice(0, 10)}
					</div>
				</div>
			)}

			{/* Composition bar fallback when profitability unavailable but composition exists */}
			{!isLoading && composition && !profitability && (
				<div className="mb-6 rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
					Verified composition available but pricing data could not be loaded.
				</div>
			)}

			{/* Profitability panel */}
			{!isLoading && profitability && (
				<div className="mb-6">
					<ProfitabilityCard
						structures={profitability.structures}
						updatedAt={profitability.updatedAt}
						pricingSnapshotDate={profitability.pricingSnapshotDate ?? null}
					/>
				</div>
			)}

			{/* Scan history */}
			<div className="rounded-md border bg-card">
				<div className="border-b px-4 py-3 text-sm font-semibold">Scan History</div>
				<div className="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Date</TableHead>
								<TableHead>Submitted By</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Ores</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(detail?.scans ?? []).map((scan) => (
								<TableRow key={scan.id}>
									<TableCell className="text-xs whitespace-nowrap">
										{formatMoonScanDateTime(scan.submittedAt)}
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{scan.submittedByName ?? scan.submittedBy ?? '?'}
									</TableCell>
									<TableCell>
										<ScanStatusBadge status={scan.status} />
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{scan.ores.map((ore, i) => {
											const data = profitability?.ores.find((o) => o.oreTypeId === ore.oreTypeId)
											const name = data?.oreName ?? ore.oreTypeId
											return (
												<span key={ore.oreTypeId}>
													{name} ({(parseFloat(ore.quantity) * 100).toFixed(1)}%)
													{i < scan.ores.length - 1 ? ', ' : ''}
												</span>
											)
										})}
									</TableCell>
								</TableRow>
							))}
							{detail?.scans.length === 0 && (
								<TableRow>
									<TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
										No scan records for this moon.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			</div>
		</Container>
	)
}
