import { getOreColor, getOreRarity } from '../ore-rarities'

import type { MoonScanOre } from '../types'

interface Props {
	ores: MoonScanOre[]
	className?: string
}

export function OreCompositionBar({ ores, className = '' }: Props) {
	const sorted = [...ores].sort((a, b) => parseFloat(b.quantity) - parseFloat(a.quantity))
	const filledPct = sorted.reduce((sum, ore) => sum + parseFloat(ore.quantity) * 100, 0)
	const remainderPct = Math.max(0, 100 - filledPct)

	return (
		<div className={`space-y-1 ${className}`}>
			<div className="flex h-4 w-full overflow-hidden rounded-sm border border-border/60 bg-muted/20">
				{sorted.map((ore) => {
					const pct = parseFloat(ore.quantity) * 100
					return (
						<div
							key={ore.oreTypeId}
							title={`Type ${ore.oreTypeId} (${getOreRarity(ore.oreTypeId) ?? '?'}) — ${pct.toFixed(1)}%`}
							style={{ width: `${pct}%`, backgroundColor: getOreColor(ore.oreTypeId) }}
						/>
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
						<span key={ore.oreTypeId} className="flex items-center gap-1 text-xs text-muted-foreground">
							<span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: getOreColor(ore.oreTypeId) }} />
							{getOreRarity(ore.oreTypeId) ?? ore.oreTypeId} {pct.toFixed(1)}%
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
