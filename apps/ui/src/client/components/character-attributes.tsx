import { getActiveLocale, useAppTranslation } from '@/i18n'
import { typeIconUrl } from '@/lib/eve-images'

import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

interface CharacterAttributesProps {
	attributes: {
		intelligence: number
		perception: number
		memory: number
		willpower: number
		charisma: number
		accruedRemapCooldownDate?: string
		bonusRemaps?: number
		lastRemapDate?: string
	}
}

/** EVE Online implant type IDs used as attribute icons (Basic attribute implants) */
const attributeTypeIds: Record<string, number> = {
	charisma: 9956, // Social Adaptation Chip - Basic
	intelligence: 9943, // Cybernetic Subprocessor - Basic
	memory: 9941, // Memory Augmentation - Basic
	perception: 9899, // Ocular Filter - Basic
	willpower: 9942, // Neural Boost - Basic
}

export function CharacterAttributes({ attributes }: CharacterAttributesProps) {
	const { t } = useAppTranslation()

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('characterpages.attributes')}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{Object.entries({
						Intelligence: attributes.intelligence,
						Perception: attributes.perception,
						Memory: attributes.memory,
						Willpower: attributes.willpower,
						Charisma: attributes.charisma,
					}).map(([name, value]) => {
						const typeId = attributeTypeIds[name.toLowerCase()]
						return (
							<div key={name} className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<img src={typeIconUrl(typeId, 32)} alt={name} className="h-5 w-5" />
									<span className="text-sm font-medium">{name}</span>
								</div>
								<span className="text-sm font-bold">{value}</span>
							</div>
						)
					})}

					{attributes.lastRemapDate && (
						<div className="pt-3 mt-3 border-t">
							<p className="text-xs text-muted-foreground">
								{t('characterpages.lastRemap')}
								{new Date(attributes.lastRemapDate).toLocaleDateString(getActiveLocale())}
							</p>
						</div>
					)}
					{attributes.bonusRemaps && attributes.bonusRemaps > 0 && (
						<p className="text-xs text-muted-foreground">
							{t('characterpages.bonusRemapsAvailable')}
							{attributes.bonusRemaps}
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
