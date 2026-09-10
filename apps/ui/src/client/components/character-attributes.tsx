import { formatDate, formatNumber, useAppTranslation } from '@/i18n'
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
	const attributeEntries = [
		{ key: 'intelligence', value: attributes.intelligence },
		{ key: 'perception', value: attributes.perception },
		{ key: 'memory', value: attributes.memory },
		{ key: 'willpower', value: attributes.willpower },
		{ key: 'charisma', value: attributes.charisma },
	] as const

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('characterDetail.attributes.title')}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{attributeEntries.map(({ key, value }) => {
						const name = t(`characterDetail.attributes.${key}`)
						const typeId = attributeTypeIds[key]
						return (
							<div key={key} className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<img src={typeIconUrl(typeId, 32)} alt={name} className="h-5 w-5" />
									<span className="text-sm font-medium">{name}</span>
								</div>
								<span className="text-sm font-bold">{formatNumber(value)}</span>
							</div>
						)
					})}

					{attributes.lastRemapDate && (
						<div className="pt-3 mt-3 border-t">
							<p className="text-xs text-muted-foreground">
								{t('characterDetail.attributes.lastRemap', {
									date: formatDate(attributes.lastRemapDate),
								})}
							</p>
						</div>
					)}
					{attributes.bonusRemaps && attributes.bonusRemaps > 0 && (
						<p className="text-xs text-muted-foreground">
							{t('characterDetail.attributes.bonusRemaps', {
								count: attributes.bonusRemaps,
								formattedCount: formatNumber(attributes.bonusRemaps),
							})}
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
