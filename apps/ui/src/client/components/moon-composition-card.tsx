import { MoonCompositionTable, MoonProfitabilityTable } from '@/components/moon-profitability-table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import type { StructureMoonComposition, StructureMoonGeography } from '@repo/structures'

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
					<MoonProfitabilityTable structure={profitability} />
				) : composition ? (
					<div className="space-y-2">
						<p className="text-sm text-muted-foreground">
							Verified composition available, but profitability data could not be loaded.
						</p>
						<MoonCompositionTable composition={composition} />
					</div>
				) : null}
				{composition?.pricingSnapshotDate ? (
					<div className="text-right text-xs text-muted-foreground">
						Pricing snapshot: {composition.pricingSnapshotDate}
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}
