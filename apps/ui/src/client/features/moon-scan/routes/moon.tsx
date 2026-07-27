import { Fragment } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ArrowLeft } from 'lucide-react'

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
import { formatISK } from '@/lib/format-utils'

import { ScanStatusBadge } from '../components/ScanStatusBadge'
import { formatMoonScanDateTime } from '../date'
import { RARITY_COLORS, getOreRarity } from '../ore-rarities'
import { useMoonDetail } from '../hooks'
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

function OreCompositionTable({ ores }: { ores: OreWithProfitability[] }) {
	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Ore</TableHead>
						<TableHead>Rarity</TableHead>
						<TableHead>Percentage</TableHead>
						<TableHead>Refines To (per 100)</TableHead>
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
												<span
													className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-white"
													style={{ backgroundColor: color }}
												>
													{ore.oreName}
												</span>
											</TableCell>
											<TableCell rowSpan={rows.length} className="align-top whitespace-nowrap">
												{rarity ? <RarityBadge rarity={rarity} /> : '—'}
											</TableCell>
											<TableCell rowSpan={rows.length} className="align-top whitespace-nowrap tabular-nums">
												{(parseFloat(ore.quantity) * 100).toFixed(2)}%
											</TableCell>
										</>
									)}
									<TableCell>
										<MaterialCell product={product} batchQty={batchQty} />
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
		<span className="text-xs">
			{rarity && <RarityBadge rarity={rarity} />}
			{rarity && ' '}
			{product.materialName}{' '}
			<span className="text-muted-foreground">×{batchQty.toLocaleString()}</span>
		</span>
	)
}

function StructurePanel({ structure }: { structure: StructureProfitability }) {
	const LABELS: Record<string, string> = { metenox: 'Metenox', tatara: 'Refinery' }
	const label = LABELS[structure.structureType] ?? structure.structureType
	const gross = parseFloat(structure.grossIsk)
	const fuel = parseFloat(structure.fuelCost)
	const magmatic = parseFloat(structure.magmaticGasCost ?? '0')
	const profit = parseFloat(structure.profit)

	return (
		<div className="p-4">
			<h6 className="text-sm font-medium mb-3">{label} (per {structure.cycleDays}d cycle)</h6>

			<Table className="mb-3 text-xs">
				<TableHeader>
					<TableRow>
						<TableHead className="text-left">Ore / Material</TableHead>
						<TableHead className="text-right">Qty</TableHead>
						<TableHead className="text-right">Value</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody className="divide-y divide-border/50">
					{structure.ores.map((ore) => {
						const oreRarity = getOreRarity(ore.oreTypeId)
						const oreColor = oreRarity ? RARITY_COLORS[oreRarity] : '#555'
						const rows = ore.refinesTo.filter((r) => r.quantity > 0)
						if (rows.length === 0) return null
						const oreValue = rows.reduce((s, r) => s + parseFloat(r.totalValue), 0)
							return (
								<Fragment key={`ore-${ore.oreTypeId}`}>
									{/* Ore header row */}
									<TableRow className="bg-muted/20">
										<TableCell colSpan={2} className="px-0 pb-1 pt-2">
										<span
											className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold text-white"
											style={{ backgroundColor: oreColor }}
										>
											{ore.oreName}
										</span>
										<span className="ml-1.5 text-muted-foreground text-xs">
											{(parseFloat(ore.quantity) * 100).toFixed(1)}%
										</span>
									</TableCell>
									<TableCell className="pb-1 pt-2 text-right tabular-nums text-muted-foreground">
										{formatISK(oreValue, { showDecimals: false })}
									</TableCell>
								</TableRow>
								{/* Material rows */}
								{rows.map((mat) => {
									const matRarity = getOreRarity(mat.materialTypeId)
									return (
										<TableRow key={`${ore.oreTypeId}-${mat.materialTypeId}`}>
											<TableCell className="py-0.5 pl-3 text-muted-foreground">
												{matRarity && <><RarityBadge rarity={matRarity} />{' '}</>}
												{mat.materialName}
											</TableCell>
											<TableCell className="py-0.5 text-right tabular-nums text-muted-foreground">{mat.quantity.toLocaleString()}</TableCell>
											<TableCell className="py-0.5 text-right tabular-nums">{formatISK(mat.totalValue, { showDecimals: false })}</TableCell>
										</TableRow>
									)
								})}
								</Fragment>
							)
						})}
				</TableBody>
			</Table>

			<Table className="border-t pt-2 text-sm">
				<TableBody>
					<TableRow>
						<TableCell className="py-1 text-muted-foreground">Gross ISK</TableCell>
						<TableCell className="py-1 text-right tabular-nums">{formatISK(String(Math.round(gross)), { showDecimals: false })}</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="py-1 text-muted-foreground">Fuel Blocks</TableCell>
						<TableCell className="py-1 text-right tabular-nums text-red-400">−{formatISK(String(Math.round(fuel)), { showDecimals: false })}</TableCell>
					</TableRow>
					{structure.magmaticGasCost && (
						<TableRow>
							<TableCell className="py-1 text-muted-foreground">Magmatic Gas</TableCell>
							<TableCell className="py-1 text-right tabular-nums text-red-400">−{formatISK(String(Math.round(magmatic)), { showDecimals: false })}</TableCell>
						</TableRow>
					)}
					<TableRow className="border-t font-semibold">
						<TableCell className="py-1.5">Profit</TableCell>
						<TableCell className={`py-1.5 text-right tabular-nums ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
							{formatISK(String(Math.round(profit)), { showDecimals: false })}
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</div>
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
	const visible = ORDER
		.map((id) => structures.find((s) => s.structureType === id))
		.filter((s): s is StructureProfitability => s !== undefined)

	return (
		<div className="rounded-md border bg-card">
			<div className="border-b px-4 py-3 text-sm font-semibold">Profitability</div>
			<div className="grid grid-cols-1 gap-0 sm:grid-cols-2 sm:divide-x">
				{visible.map((s) => <StructurePanel key={s.structureType} structure={s} />)}
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
	const { canView } = useMoonScanPermissions()

	const { data: detail, isLoading, error } = useMoonDetail(moonId!, canView)
	usePageTitle(detail?.moon?.moonName ? `${detail.moon.moonName} — Moon` : 'Moon Detail')

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

	return (
		<Container>
			<PageHeader
				title={moon?.moonName ?? moonId!}
				description={
					moon ? `Moon ID: ${moon.moonId}` : undefined
				}
				action={(
					<div className="flex flex-col items-end gap-2">
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Link to="/moon-scan" className="hover:underline">Moons</Link>
							{moon?.solarSystemId && (
								<>
									<span>/</span>
									<Link to={`/moon-scan/system/${moon.solarSystemId}`} className="hover:underline">
										{moon.solarSystemName || 'System'}
									</Link>
								</>
							)}
							<span>/</span>
							<span>{moon?.moonName ?? moonId}</span>
						</div>
						{moon?.solarSystemId ? (
							<Button variant="ghost" size="sm" asChild>
								<Link to={`/moon-scan/system/${moon.solarSystemId}`}>
									<ArrowLeft className="mr-2 h-4 w-4" />
									Back to System
								</Link>
							</Button>
						) : (
							<Button variant="ghost" size="sm" asChild>
								<Link to="/moon-scan">
									<ArrowLeft className="mr-2 h-4 w-4" />
									Back to Regions
								</Link>
							</Button>
						)}
					</div>
				)}
			/>

			<div className="mb-6 -mt-3">
				<div className="flex items-center gap-3 flex-wrap">
					{composition ? (
						<Badge className="bg-green-500/20 text-green-400 border-green-500/30">verified</Badge>
					) : !isLoading ? (
						<Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">unverified</Badge>
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
						Verified{composition.verifiedBy ? ` by ${composition.verifiedByName ?? composition.verifiedBy}` : ''} on{' '}
						{new Date(composition.verifiedAt).toISOString().slice(0, 10)}
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
										<TableCell><ScanStatusBadge status={scan.status} /></TableCell>
										<TableCell className="text-xs text-muted-foreground">
											{scan.ores.map((ore, i) => {
												const data = profitability?.ores.find((o) => o.oreTypeId === ore.oreTypeId)
												const name = data?.oreName ?? ore.oreTypeId
											return (
												<span key={ore.oreTypeId}>
													{name} ({(parseFloat(ore.quantity) * 100).toFixed(1)}%){i < scan.ores.length - 1 ? ', ' : ''}
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
