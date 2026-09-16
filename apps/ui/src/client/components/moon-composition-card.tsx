import { MoonCompositionTable, MoonProfitabilityTable } from '@/components/moon-profitability-table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppTranslation } from '@/i18n'

import type { StructureMoonComposition, StructureMoonGeography } from '@repo/structures'

export interface MoonCompositionCardProps {
	composition: StructureMoonComposition | null | undefined
	moon: StructureMoonGeography | null | undefined
}

export function MoonCompositionCard({ composition, moon }: MoonCompositionCardProps) {
	const { t } = useAppTranslation()

	const profitability = composition?.profitability

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('moonScan.moonResources')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				<div className="grid gap-4 border-b border-border/60 pb-4 md:grid-cols-3">
					<div>
						<div className="text-muted-foreground">{t('moonScan.moon')}</div>
						<div className="font-medium">{moon?.moonName ?? moon?.moonId ?? '-'}</div>
					</div>
					<div>
						<div className="text-muted-foreground">{t('moonScan.planet')}</div>
						<div className="font-medium">{moon?.planetName ?? moon?.planetId ?? '-'}</div>
					</div>
					<div>
						<div className="text-muted-foreground">{t('moonScan.system')}</div>
						<div className="font-medium">{moon?.systemName ?? moon?.systemId ?? '-'}</div>
					</div>
				</div>

				{!composition ? (
					<p className="text-sm text-muted-foreground">
						{t('moonScan.noVerifiedMoonCompositionIsAvailableForThisMoon')}
					</p>
				) : null}

				{profitability ? (
					<MoonProfitabilityTable structure={profitability} />
				) : composition ? (
					<div className="space-y-2">
						<p className="text-sm text-muted-foreground">
							{t('moonScan.verifiedCompositionAvailableButProfitabilityDataCouldNotBeLoaded')}
						</p>
						<MoonCompositionTable composition={composition} />
					</div>
				) : null}
				{composition?.pricingSnapshotDate ? (
					<div className="text-right text-xs text-muted-foreground">
						{t('moonScan.pricingSnapshot')}
						{composition.pricingSnapshotDate}
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}
