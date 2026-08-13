import { Fragment } from 'react'

import { FUEL_BLOCK_TYPE_IDS, SKYHOOK_MAGMATIC_GAS_TYPE_ID } from '@repo/structures'

import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { typeIconUrl } from '@/lib/eve-images'
import { formatISK } from '@/lib/format-utils'

import { getOreRarity, RARITY_COLORS } from '../features/moon-scan/ore-rarities'

import type { StructureMoonComposition } from '@repo/structures'
import type { StructureProfitability } from '../features/moon-scan/types'

const FUEL_BLOCK_ICON_TYPE_ID = Array.from(FUEL_BLOCK_TYPE_IDS)[0] ?? '4247'

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

function MaterialCell({
	materialName,
	materialTypeId,
	materialRarity,
}: {
	materialName: string
	materialTypeId: string
	materialRarity: string | null
}) {
	const rarity = materialRarity ?? getOreRarity(materialTypeId)
	return (
		<div className="flex items-center gap-2">
			<span>
				{rarity && (
					<>
						<RarityBadge rarity={rarity} />{' '}
					</>
				)}
				<img
					src={typeIconUrl(materialTypeId, 32)}
					alt=""
					className="inline-block h-5 w-5 rounded align-middle"
					loading="lazy"
				/>{' '}
				<span className="font-semibold text-foreground">{materialName}</span>
			</span>
		</div>
	)
}

export function MoonProfitabilityTable({ structure }: { structure: StructureProfitability }) {
	const LABELS: Record<string, string> = { metenox: 'Metenox', tatara: 'Refinery' }
	const label = LABELS[structure.structureType] ?? structure.structureType
	const gross = parseFloat(structure.grossIsk)
	const fuel = parseFloat(structure.fuelCost)
	const magmatic = parseFloat(structure.magmaticGasCost ?? '0')
	const profit = parseFloat(structure.profit)
	const rawOreVolumeM3 = structure.ores.reduce((sum, ore) => sum + ore.oreVolumeM3, 0)
	const refinedVolumeM3 = structure.ores.some((ore) => ore.volumeM3 === null)
		? null
		: structure.ores.reduce((sum, ore) => sum + (ore.volumeM3 ?? 0), 0)

	return (
		<div className="p-4">
			<h6 className="mb-3 text-sm font-medium">
				{label} (per {structure.cycleDays}d cycle)
			</h6>

			<Table className="mb-3 text-xs">
				<TableHeader>
					<TableRow>
						<TableHead className="text-left">Ore / Material</TableHead>
						<TableHead className="text-right">Qty</TableHead>
						<TableHead className="text-right">Volume (m3)</TableHead>
						<TableHead className="text-right">Refined value</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody className="divide-y divide-border/50">
					{structure.ores.map((ore) => {
						const oreRarity = getOreRarity(ore.oreTypeId)
						const oreColor = oreRarity ? RARITY_COLORS[oreRarity] : '#555'
						const rows = ore.refinesTo.filter((row) => row.quantity > 0)
						const oreValue = rows.reduce((sum, row) => sum + parseFloat(row.totalValue), 0)
						return (
							<Fragment key={`ore-${ore.oreTypeId}`}>
								<TableRow className="bg-muted/20">
									<TableCell className="px-0 pb-1 pt-2">
										<div className="flex items-center gap-2 whitespace-nowrap">
											<span
												className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold text-white"
												style={{ backgroundColor: oreColor }}
											>
												{ore.oreName}
											</span>
											<img
												src={typeIconUrl(ore.oreTypeId, 32)}
												alt=""
												className="h-5 w-5 rounded"
												loading="lazy"
											/>
											<span className="whitespace-nowrap text-xs text-muted-foreground">
												{(parseFloat(ore.quantity) * 100).toFixed(1)}%
											</span>
										</div>
									</TableCell>
									<TableCell className="pb-1 pt-2 text-right tabular-nums text-muted-foreground">
										{ore.oreUnits.toLocaleString()}
									</TableCell>
									<TableCell className="pb-1 pt-2 text-right tabular-nums text-muted-foreground">
										{formatVolumeM3(ore.oreVolumeM3)}
									</TableCell>
									<TableCell className="pb-1 pt-2 text-right tabular-nums text-muted-foreground">
										{formatISK(oreValue, { showDecimals: false })}
									</TableCell>
								</TableRow>
								{rows.map((material) => (
									<TableRow key={`${ore.oreTypeId}-${material.materialTypeId}`}>
										<TableCell className="py-0.5 pl-3 text-muted-foreground">
											<MaterialCell
												materialName={material.materialName}
												materialTypeId={material.materialTypeId}
												materialRarity={material.materialRarity}
											/>
										</TableCell>
										<TableCell className="py-0.5 text-right tabular-nums text-muted-foreground">
											{material.quantity.toLocaleString()}
										</TableCell>
										<TableCell className="py-0.5 text-right tabular-nums text-muted-foreground">
											{formatVolumeM3(material.volumeM3)}
										</TableCell>
										<TableCell className="py-0.5 text-right tabular-nums">
											{formatISK(material.totalValue, { showDecimals: false })}
										</TableCell>
									</TableRow>
								))}
							</Fragment>
						)
					})}
				</TableBody>
			</Table>

			<Table className="border-t pt-2 text-sm">
				<TableBody>
					<TableRow>
						<TableCell className="py-1 text-muted-foreground">Total raw ore volume</TableCell>
						<TableCell className="py-1 text-right font-semibold tabular-nums">
							{formatVolumeM3(rawOreVolumeM3)}
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="py-1 text-muted-foreground">Total refined volume</TableCell>
						<TableCell className="py-1 text-right font-semibold tabular-nums">
							{formatVolumeM3(refinedVolumeM3)}
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="py-1 text-muted-foreground">Gross ISK</TableCell>
						<TableCell className="py-1 text-right font-semibold tabular-nums">
							{formatISK(String(Math.round(gross)), { showDecimals: false })}
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="py-1 text-muted-foreground">
							<span className="inline-flex items-center gap-2">
								<img
									src={typeIconUrl(FUEL_BLOCK_ICON_TYPE_ID, 32)}
									alt=""
									className="h-5 w-5 rounded"
									loading="lazy"
								/>
								Fuel Blocks
							</span>
						</TableCell>
						<TableCell className="py-1 text-right font-semibold tabular-nums text-red-400">
							−{formatISK(String(Math.round(fuel)), { showDecimals: false })}
						</TableCell>
					</TableRow>
					{structure.magmaticGasCost && (
						<TableRow>
							<TableCell className="py-1 text-muted-foreground">
								<span className="inline-flex items-center gap-2">
									<img
										src={typeIconUrl(SKYHOOK_MAGMATIC_GAS_TYPE_ID, 32)}
										alt=""
										className="h-5 w-5 rounded"
										loading="lazy"
									/>
									Magmatic Gas
								</span>
							</TableCell>
							<TableCell className="py-1 text-right font-semibold tabular-nums text-red-400">
								−{formatISK(String(Math.round(magmatic)), { showDecimals: false })}
							</TableCell>
						</TableRow>
					)}
					<TableRow className="border-t font-semibold">
						<TableCell className="py-1.5">Profit</TableCell>
						<TableCell
							className={`py-1.5 text-right tabular-nums ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}
						>
							{formatISK(String(Math.round(profit)), { showDecimals: false })}
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</div>
	)
}

export function MoonCompositionTable({ composition }: { composition: StructureMoonComposition }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Mineral</TableHead>
					<TableHead>Rarity</TableHead>
					<TableHead className="text-right">Composition</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{[...composition.ores]
					.sort((left, right) => Number(right.quantity) - Number(left.quantity))
					.map((ore) => {
						const rarity = ore.rarity ?? getOreRarity(ore.typeId)
						return (
							<TableRow key={ore.typeId}>
								<TableCell>
									<div className="flex items-center gap-2">
										<img src={typeIconUrl(ore.typeId, 32)} alt="" className="h-6 w-6 rounded" />
										<span>{ore.typeName ?? `Type ${ore.typeId}`}</span>
									</div>
								</TableCell>
								<TableCell>{rarity ? <RarityBadge rarity={rarity} /> : '—'}</TableCell>
								<TableCell className="text-right tabular-nums">
									{(Number(ore.quantity) * 100).toFixed(2)}%
								</TableCell>
							</TableRow>
						)
					})}
			</TableBody>
		</Table>
	)
}
