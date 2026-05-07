import { Link, useParams } from 'react-router-dom'

import { ArrowLeft } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { Skeleton } from '@/components/ui/skeleton'
import { formatISK } from '@/lib/format-utils'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { RARITY_COLORS, getOreRarity } from '../ore-rarities'
import { useMoonDetail } from '../hooks'

import type { MoonScanStatus, OreRefineProduct, OreWithProfitability, StructureProfitability } from '../types'

function StatusBadge({ status }: { status: MoonScanStatus }) {
	if (status === 'verified') return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">verified</Badge>
	if (status === 'rejected') return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">rejected</Badge>
	return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">pending</Badge>
}

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
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b text-left text-xs text-muted-foreground">
						<th className="px-4 py-2 font-medium">Ore</th>
						<th className="px-4 py-2 font-medium">Rarity</th>
						<th className="px-4 py-2 font-medium">Percentage</th>
						<th className="px-4 py-2 font-medium">Refines To (per 100)</th>
						<th className="px-4 py-2 font-medium text-right">Jita Sell</th>
						<th className="px-4 py-2 font-medium text-right">Per 100 ore</th>
					</tr>
				</thead>
				<tbody className="divide-y">
					{ores.map((ore) => {
						const rarity = getOreRarity(ore.oreTypeId)
						const color = rarity ? RARITY_COLORS[rarity] : '#555'
						const rows = ore.refinesTo.filter((r) => r.quantity > 0)
						return rows.map((product, idx) => {
							const batchQty = product.batchQty
							const per100Value = batchQty * parseFloat(product.unitSellPrice)
							return (
								<tr key={`${ore.oreTypeId}-${product.materialTypeId}`}>
									{idx === 0 && (
										<>
											<td rowSpan={rows.length} className="px-4 py-2.5 align-top">
												<span
													className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-white"
													style={{ backgroundColor: color }}
												>
													{ore.oreName}
												</span>
											</td>
											<td rowSpan={rows.length} className="px-4 py-2.5 align-top whitespace-nowrap">
												{rarity ? <RarityBadge rarity={rarity} /> : '—'}
											</td>
											<td rowSpan={rows.length} className="px-4 py-2.5 align-top whitespace-nowrap tabular-nums">
												{(parseFloat(ore.quantity) * 100).toFixed(2)}%
											</td>
										</>
									)}
									<td className="px-4 py-2.5">
										<MaterialCell product={product} batchQty={batchQty} />
									</td>
									<td className="px-4 py-2.5 text-right tabular-nums text-xs">
										{formatISK(product.unitSellPrice, { showDecimals: false })}
									</td>
									<td className="px-4 py-2.5 text-right tabular-nums text-xs">
										{formatISK(per100Value, { showDecimals: false })}
									</td>
								</tr>
							)
						})
					})}
				</tbody>
			</table>
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

interface MaterialBreakdownRow {
	materialTypeId: string
	materialName: string
	quantity: number
	totalValue: number
}

function buildMaterialBreakdown(ores: OreWithProfitability[], isPassive: boolean): MaterialBreakdownRow[] {
	const MINERAL_IDS = new Set(['35', '36'])
	const map = new Map<string, MaterialBreakdownRow>()

	for (const ore of ores) {
		for (const product of ore.refinesTo) {
			if (isPassive && MINERAL_IDS.has(product.materialTypeId)) continue
			if (product.quantity === 0) continue
			const existing = map.get(product.materialTypeId)
			const value = parseFloat(product.totalValue)
			if (existing) {
				existing.quantity += product.quantity
				existing.totalValue += value
			} else {
				map.set(product.materialTypeId, {
					materialTypeId: product.materialTypeId,
					materialName: product.materialName,
					quantity: product.quantity,
					totalValue: value,
				})
			}
		}
	}

	return Array.from(map.values()).sort((a, b) => b.totalValue - a.totalValue)
}

function ProfitabilityCard({ ores, structures, updatedAt }: { ores: OreWithProfitability[]; structures: StructureProfitability[]; updatedAt: string }) {
	const metenox = structures.find((s) => s.structureType === 'metenox')
	const tatara = structures.find((s) => s.structureType === 'tatara')

	const metenoxMaterials = metenox ? buildMaterialBreakdown(ores, true) : []
	const tataraMaterials = tatara ? buildMaterialBreakdown(ores, false) : []

	return (
		<div className="rounded-md border bg-card">
			<div className="border-b px-4 py-3 text-sm font-semibold">Profitability</div>
			<div className="grid grid-cols-1 gap-0 sm:grid-cols-2 sm:divide-x">
				{metenox && (
					<div className="p-4">
						<h6 className="text-sm font-medium mb-3">Metenox (per {metenox.cycleDays}d cycle)</h6>

						{/* Material breakdown */}
						<table className="w-full text-xs mb-3">
							<thead>
								<tr className="border-b text-muted-foreground">
									<th className="pb-1 font-medium text-left">Material</th>
									<th className="pb-1 font-medium text-right">Qty</th>
									<th className="pb-1 font-medium text-right">Value</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border/50">
								{metenoxMaterials.map((m) => {
									const rarity = getOreRarity(m.materialTypeId)
									return (
										<tr key={m.materialTypeId}>
											<td className="py-1">
												{rarity && <><RarityBadge rarity={rarity} />{' '}</>}
												{m.materialName}
											</td>
											<td className="py-1 text-right tabular-nums text-muted-foreground">{m.quantity.toLocaleString()}</td>
											<td className="py-1 text-right tabular-nums">{formatISK(m.totalValue, { showDecimals: false })}</td>
										</tr>
									)
								})}
							</tbody>
						</table>

						{/* Summary */}
						<table className="w-full text-sm border-t pt-2">
							<tbody>
								<tr>
									<td className="py-1 text-muted-foreground">Gross ISK</td>
									<td className="py-1 text-right tabular-nums">{formatISK(metenox.grossIsk, { showDecimals: false })}</td>
								</tr>
								<tr>
									<td className="py-1 text-muted-foreground">Fuel Blocks</td>
									<td className="py-1 text-right tabular-nums text-red-400">−{formatISK(metenox.fuelCost, { showDecimals: false })}</td>
								</tr>
								{metenox.magmaticGasCost && (
									<tr>
										<td className="py-1 text-muted-foreground">Magmatic Gas</td>
										<td className="py-1 text-right tabular-nums text-red-400">−{formatISK(metenox.magmaticGasCost, { showDecimals: false })}</td>
									</tr>
								)}
								<tr className="border-t font-semibold">
									<td className="py-1.5">Profit</td>
									<td className={`py-1.5 text-right tabular-nums ${parseFloat(metenox.profit) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
										{formatISK(metenox.profit, { showDecimals: false })}
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				)}
				{tatara && (
					<div className="p-4">
						<h6 className="text-sm font-medium mb-3">Refinery (per {tatara.cycleDays}d cycle)</h6>

						{/* Material breakdown */}
						<table className="w-full text-xs mb-3">
							<thead>
								<tr className="border-b text-muted-foreground">
									<th className="pb-1 font-medium text-left">Material</th>
									<th className="pb-1 font-medium text-right">Qty</th>
									<th className="pb-1 font-medium text-right">Value</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border/50">
								{tataraMaterials.map((m) => {
									const rarity = getOreRarity(m.materialTypeId)
									return (
										<tr key={m.materialTypeId}>
											<td className="py-1">
												{rarity && <><RarityBadge rarity={rarity} />{' '}</>}
												{m.materialName}
											</td>
											<td className="py-1 text-right tabular-nums text-muted-foreground">{m.quantity.toLocaleString()}</td>
											<td className="py-1 text-right tabular-nums">{formatISK(m.totalValue, { showDecimals: false })}</td>
										</tr>
									)
								})}
							</tbody>
						</table>

						{/* Summary */}
						<table className="w-full text-sm border-t pt-2">
							<tbody>
								<tr>
									<td className="py-1 text-muted-foreground">Gross ISK</td>
									<td className="py-1 text-right tabular-nums">{formatISK(tatara.grossIsk, { showDecimals: false })}</td>
								</tr>
								<tr>
									<td className="py-1 text-muted-foreground">Fuel Cost</td>
									<td className="py-1 text-right tabular-nums text-red-400">−{formatISK(tatara.fuelCost, { showDecimals: false })}</td>
								</tr>
								<tr className="border-t font-semibold">
									<td className="py-1.5">Profit</td>
									<td className={`py-1.5 text-right tabular-nums ${parseFloat(tatara.profit) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
										{formatISK(tatara.profit, { showDecimals: false })}
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				)}
			</div>
			<div className="border-t px-4 py-2 text-xs text-muted-foreground">
				Updated {new Date(updatedAt).toUTCString().replace(':00 GMT', ' UTC')}
			</div>
		</div>
	)
}

export default function MoonPage() {
	const { moonId } = useParams<{ moonId: string }>()
	const { hasPermission, isAdmin } = useUserPermissions()
	const canView = isAdmin || hasPermission('urn:moons:view')

	const { data: detail, isLoading, error } = useMoonDetail(moonId!)

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
			{/* Breadcrumb */}
			<div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
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

			{/* Title + badges */}
			<div className="mt-2 mb-6">
				<div className="flex items-center justify-between flex-wrap gap-2">
				<div className="flex items-center gap-3 flex-wrap">
					<h1 className="text-2xl font-bold">{moon?.moonName ?? moonId}</h1>
					{composition
						? <Badge className="bg-green-500/20 text-green-400 border-green-500/30">verified</Badge>
						: !isLoading && <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">unverified</Badge>
					}
				</div>
				{moon?.solarSystemId && (
					<Button variant="ghost" size="sm" asChild>
						<Link to={`/moon-scan/system/${moon.solarSystemId}`}>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back
						</Link>
					</Button>
				)}
				</div>
				{moon && (
					<p className="text-sm text-muted-foreground mt-1">Moon ID: {moon.moonId}</p>
				)}
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
					<ProfitabilityCard ores={profitability.ores} structures={profitability.structures} updatedAt={profitability.updatedAt} />
				</div>
			)}

			{/* Scan history */}
			<div className="rounded-md border bg-card">
				<div className="border-b px-4 py-3 text-sm font-semibold">Scan History</div>
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-xs text-muted-foreground">
								<th className="px-4 py-2 font-medium">Date</th>
								<th className="px-4 py-2 font-medium">Submitted By</th>
								<th className="px-4 py-2 font-medium">Status</th>
								<th className="px-4 py-2 font-medium">Ores</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{(detail?.scans ?? []).map((scan) => (
								<tr key={scan.id}>
									<td className="px-4 py-2.5 text-xs whitespace-nowrap">
										{new Date(scan.submittedAt).toISOString().slice(0, 16).replace('T', ' ')}
									</td>
									<td className="px-4 py-2.5 text-xs text-muted-foreground">
										{scan.submittedByName ?? scan.submittedBy ?? '?'}
									</td>
									<td className="px-4 py-2.5">
										<StatusBadge status={scan.status} />
									</td>
									<td className="px-4 py-2.5 text-xs text-muted-foreground">
										{scan.ores.map((ore, i) => {
											const data = profitability?.ores.find((o) => o.oreTypeId === ore.oreTypeId)
											const name = data?.oreName ?? ore.oreTypeId
											return (
												<span key={ore.oreTypeId}>
													{name} ({(parseFloat(ore.quantity) * 100).toFixed(1)}%){i < scan.ores.length - 1 ? ', ' : ''}
												</span>
											)
										})}
									</td>
								</tr>
							))}
							{detail?.scans.length === 0 && (
								<tr>
									<td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
										No scan records for this moon.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</Container>
	)
}
