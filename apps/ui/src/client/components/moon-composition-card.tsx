import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

import type { StructureMoonComposition, StructureMoonGeography } from '@repo/structures'

function RarityBadge({ rarity }: { rarity: string | null | undefined }) {
	if (!rarity) return <span className="text-muted-foreground">-</span>

	return (
		<span
			className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold text-white"
			style={{ backgroundColor: RARITY_COLORS[rarity as keyof typeof RARITY_COLORS] ?? '#555' }}
		>
			{rarity}
		</span>
	)
}

export interface MoonCompositionCardProps {
	composition: StructureMoonComposition | null | undefined
	moon: StructureMoonGeography | null | undefined
}

export function MoonCompositionCard({ composition, moon }: MoonCompositionCardProps) {
	const profitability = composition?.profitability

	return (
		<Card>
			<CardHeader>
				<CardTitle>Moon Resources</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				<div className="grid gap-4 border-b border-border/60 pb-4 md:grid-cols-3">
					<div>
						<div className="text-muted-foreground">Moon</div>
						<div className="font-medium">{moon?.moonName ?? moon?.moonId ?? '-'}</div>
					</div>
					<div>
						<div className="text-muted-foreground">Planet</div>
						<div className="font-medium">{moon?.planetName ?? moon?.planetId ?? '-'}</div>
					</div>
					<div>
						<div className="text-muted-foreground">System</div>
						<div className="font-medium">{moon?.systemName ?? moon?.systemId ?? '-'}</div>
					</div>
				</div>

				{!composition ? (
					<p className="text-sm text-muted-foreground">
						No verified moon composition is available for this moon.
					</p>
				) : null}

				{profitability ? (
					<div className="ml-auto w-full max-w-sm space-y-1 border-b border-border/60 pb-3 text-right font-mono text-xs">
						<div className="flex justify-between">
							<span>Gross refinery value</span>
							<span className="text-foreground">
								{formatISK(profitability.grossIsk, { showDecimals: false })}
							</span>
						</div>
						<div className="flex justify-between text-muted-foreground">
							<span>− Fuel blocks</span>
							<span className="text-red-400">
								−{formatISK(profitability.fuelCost, { showDecimals: false })}
							</span>
						</div>
						{profitability.magmaticGasCost !== null ? (
							<div className="flex justify-between text-muted-foreground">
								<span>− Magmatic gas</span>
								<span className="text-red-400">
									−{formatISK(profitability.magmaticGasCost, { showDecimals: false })}
								</span>
							</div>
						) : null}
						<div className="my-1 border-t border-border/50" />
						<div className="flex justify-between font-semibold">
							<span>
								{profitability.structureType === 'metenox' ? 'Metenox value' : 'Refinery profit'} /{' '}
								{profitability.cycleDays}d
							</span>
							<span
								className={Number(profitability.profit) >= 0 ? 'text-green-400' : 'text-red-400'}
							>
								{formatISK(profitability.profit, { showDecimals: false })}
							</span>
						</div>
						{composition.pricingSnapshotDate ? (
							<div className="text-muted-foreground">
								Pricing snapshot: {composition.pricingSnapshotDate}
							</div>
						) : null}
					</div>
				) : null}

				{composition ? (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Mineral</TableHead>
								<TableHead>Rarity</TableHead>
								<TableHead className="text-right">Composition</TableHead>
								<TableHead className="text-right">Estimated value</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{[...composition.ores]
								.sort((left, right) => Number(right.quantity) - Number(left.quantity))
								.map((ore) => {
									const rarity = ore.rarity ?? getOreRarity(ore.typeId) ?? null
									const estimate = profitability?.ores.find(
										(candidate) => candidate.oreTypeId === ore.typeId
									)
									return (
										<TableRow key={ore.typeId}>
											<TableCell>
												<div className="flex items-center gap-2">
													<img
														src={typeIconUrl(ore.typeId, 32)}
														alt=""
														className="h-6 w-6 rounded"
													/>
													<span>{ore.typeName ?? `Type ${ore.typeId}`}</span>
												</div>
											</TableCell>
											<TableCell>
												<RarityBadge rarity={rarity} />
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{(Number(ore.quantity) * 100).toFixed(2)}%
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{estimate
													? formatISK(estimate.totalOreValue, { showDecimals: false })
													: '-'}
											</TableCell>
										</TableRow>
									)
								})}
						</TableBody>
					</Table>
				) : null}
			</CardContent>
		</Card>
	)
}
