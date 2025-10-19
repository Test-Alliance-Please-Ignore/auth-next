import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Brain, Eye, HardDrive, Zap, Heart } from 'lucide-react'

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

const attributeIcons = {
	intelligence: Brain,
	perception: Eye,
	memory: HardDrive,
	willpower: Zap,
	charisma: Heart,
}

export function CharacterAttributes({ attributes }: CharacterAttributesProps) {
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
						const IconComponent = attributeIcons[name.toLowerCase() as keyof typeof attributeIcons]
						return (
							<div key={name} className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<IconComponent className="h-4 w-4 text-muted-foreground" />
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
				</div>
			</CardContent>
		</Card>
	)
}