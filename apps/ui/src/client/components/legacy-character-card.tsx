import { Link2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

import type { LegacyCharacter } from '@/hooks/useAuth'

interface LegacyCharacterCardProps {
	character: LegacyCharacter
	onLink: (characterId: string) => void
	isLinking: boolean
}

export function LegacyCharacterCard({ character, onLink, isLinking }: LegacyCharacterCardProps) {
	const handleClick = () => {
		if (!isLinking) {
			onLink(character.characterId)
		}
	}

	return (
		<Card
			className="group relative cursor-pointer opacity-50 hover:opacity-75 transition-opacity border-dashed"
			onClick={handleClick}
			title="This character needs to be linked to your account. Click to start the linking process."
		>
			<CardContent className="p-4">
				<div className="flex items-center gap-3">
					<img
						src={`/images/characters/${character.characterId}/portrait?size=64`}
						alt={`${character.characterName}'s portrait`}
						loading="lazy"
						onError={(e) => {
							;(e.currentTarget as HTMLImageElement).src =
								'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"%3E%3Crect fill="%23404040" width="64" height="64"/%3E%3Ctext x="50%25" y="50%25" font-family="Arial" font-size="24" fill="%23bfbfbf" text-anchor="middle" dominant-baseline="middle"%3E?%3C/text%3E%3C/svg%3E'
						}}
						className="w-12 h-12 rounded-full border border-border/50 group-hover:border-primary/30 transition-colors shadow-md"
					/>
					<div className="flex-1 min-w-0">
						<h3 className="font-semibold truncate group-hover:text-primary transition-colors">
							{character.characterName}
						</h3>
						<div className="flex items-center gap-2 mt-1">
							<Badge variant="warning" className="text-xs">
								{isLinking ? 'Linking...' : 'Needs Linking'}
							</Badge>
						</div>
					</div>
					<Link2
						className={`h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors ${
							isLinking ? 'animate-pulse' : ''
						}`}
					/>
				</div>
			</CardContent>
		</Card>
	)
}
