import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { formatISK } from '../lib/format-utils'

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
	walletBalance?: string
}

/** EVE Online implant type IDs used as attribute icons (Basic attribute implants) */
const attributeTypeIds: Record<string, number> = {
	charisma: 9956, // Social Adaptation Chip - Basic
	intelligence: 9943, // Cybernetic Subprocessor - Basic
	memory: 9941, // Memory Augmentation - Basic
	perception: 9899, // Ocular Filter - Basic
	willpower: 9942, // Neural Boost - Basic
}

export function CharacterAttributes({ attributes, walletBalance }: CharacterAttributesProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Attributes</CardTitle>
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
									<img
										src={`https://images.evetech.net/types/${typeId}/icon?size=32`}
										alt={name}
										className="h-5 w-5"
									/>
									<span className="text-sm font-medium">{name}</span>
								</div>
								<span className="text-sm font-bold">{value}</span>
							</div>
						)
					})}

					{attributes.lastRemapDate && (
						<div className="pt-3 mt-3 border-t">
							<p className="text-xs text-muted-foreground">
								Last remap: {new Date(attributes.lastRemapDate).toLocaleDateString()}
							</p>
						</div>
					)}
					{attributes.bonusRemaps && attributes.bonusRemaps > 0 && (
						<p className="text-xs text-muted-foreground">
							Bonus remaps available: {attributes.bonusRemaps}
						</p>
					)}
					{walletBalance && (
						<div className="pt-3 mt-3 border-t">
							<p className="text-xs text-muted-foreground">Wallet Balance</p>
							<p className="text-sm font-bold">{formatISK(walletBalance)}</p>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
