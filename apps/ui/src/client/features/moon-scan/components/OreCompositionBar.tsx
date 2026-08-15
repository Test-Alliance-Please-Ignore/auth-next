import { HoverPopover } from '@/components/ui/hover-popover'

import { getOreColor, getOreRarity, RARITY_COLORS } from '../ore-rarities'

import type { MoonScanOre, OreRarity } from '../types'

interface Props {
	ores: MoonScanOre[]
	className?: string
}

const ORE_VARIANT_FILTERS = [
	'brightness(0.78)',
	'brightness(1)',
	'brightness(1.22)',
	'brightness(1.42)',
]

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

function getOreVariantIndexes(ores: MoonScanOre[]): Map<string, number> {
	const oresByRarity = new Map<string, string[]>()
	for (const ore of ores) {
		const rarity = getOreRarity(ore.oreTypeId) ?? `unknown:${ore.oreTypeId}`
		const typeIds = oresByRarity.get(rarity) ?? []
		if (!typeIds.includes(ore.oreTypeId)) typeIds.push(ore.oreTypeId)
		oresByRarity.set(rarity, typeIds)
	}

	const variantIndexes = new Map<string, number>()
	for (const typeIds of oresByRarity.values()) {
		if (typeIds.length < 2) continue
		for (const [index, typeId] of [...typeIds].sort().entries()) {
			variantIndexes.set(typeId, index % ORE_VARIANT_FILTERS.length)
		}
	}
	return variantIndexes
}

function getOreVariantFilter(variantIndexes: Map<string, number>, oreTypeId: string) {
	const variantIndex = variantIndexes.get(oreTypeId)
	return variantIndex === undefined ? undefined : ORE_VARIANT_FILTERS[variantIndex]
}

export function OreCompositionBar({ ores, className = '' }: Props) {
	const sorted = [...ores].sort((a, b) => parseFloat(b.quantity) - parseFloat(a.quantity))
	const variantIndexes = getOreVariantIndexes(ores)
	const filledPct = sorted.reduce((sum, ore) => sum + parseFloat(ore.quantity) * 100, 0)
	const remainderPct = Math.max(0, 100 - filledPct)

	return (
		<div className={`space-y-1 ${className}`}>
			<div className="flex h-4 w-full overflow-hidden rounded-sm border border-border/60 bg-muted/20">
				{sorted.map((ore) => {
					const pct = parseFloat(ore.quantity) * 100
					const rarity = getOreRarity(ore.oreTypeId)
					return (
						<div key={ore.oreTypeId} className="h-full" style={{ width: `${pct}%` }}>
							<HoverPopover
								fullWidth
								triggerClassName="h-full w-full"
								trigger={
									<span
										aria-label={ore.oreTypeName ?? `Type ${ore.oreTypeId}`}
										className="block h-full cursor-help"
										style={{
											backgroundColor: getOreColor(ore.oreTypeId),
											filter: getOreVariantFilter(variantIndexes, ore.oreTypeId),
										}}
									/>
								}
								className="border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
							>
								<div className="flex items-center gap-2 text-sm font-medium">
									{rarity ? <RarityBadge rarity={rarity} /> : null}
									<span>{ore.oreTypeName ?? `Type ${ore.oreTypeId}`}</span>
								</div>
								<div className="text-xs text-muted-foreground">{pct.toFixed(1)}% composition</div>
							</HoverPopover>
						</div>
					)
				})}
				{remainderPct > 0 && (
					<div
						title={`Unreported remainder — ${remainderPct.toFixed(1)}%`}
						className="bg-transparent"
						style={{ width: `${remainderPct}%` }}
					/>
				)}
			</div>
			<div className="flex flex-wrap gap-x-3 gap-y-0.5">
				{sorted.map((ore) => {
					const pct = parseFloat(ore.quantity) * 100
					return (
						<span
							key={ore.oreTypeId}
							className="flex items-center gap-1 text-xs text-muted-foreground"
						>
							<span
								className="inline-block h-2 w-2 rounded-sm"
								style={{
									backgroundColor: getOreColor(ore.oreTypeId),
									filter: getOreVariantFilter(variantIndexes, ore.oreTypeId),
								}}
							/>
							{ore.oreTypeName ?? ore.oreTypeId} {pct.toFixed(1)}%
						</span>
					)
				})}
				{remainderPct > 0 && (
					<span className="flex items-center gap-1 text-xs text-muted-foreground">
						<span className="inline-block h-2 w-2 rounded-sm border border-border/70 bg-transparent" />
						Unreported {remainderPct.toFixed(1)}%
					</span>
				)}
			</div>
		</div>
	)
}
