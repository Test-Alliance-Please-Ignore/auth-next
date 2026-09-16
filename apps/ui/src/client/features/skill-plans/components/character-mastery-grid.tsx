import { AlertCircle } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { useAppTranslation } from '@/i18n'

import { useCharacterSkillLevelsForCharacters, usePlanSkills } from '../hooks'
import { calculateCharacterProgress } from '../utils/readiness'
import { CharacterMasteryCard } from './character-mastery-card'

interface CharacterMasteryGridProps {
	planId: string
	title?: string
	onCharacterClick?: (characterId: string) => void
}

export function CharacterMasteryGrid({
	planId,
	title: providedTitle,
	onCharacterClick,
}: CharacterMasteryGridProps) {
	const { t } = useAppTranslation()
	const title = providedTitle ?? t('skillPlans.characterReadiness')

	const { user } = useAuth()

	// Get all user characters
	const characters = user?.characters || []
	const { data: planSkills, isLoading: planSkillsLoading } = usePlanSkills(planId)

	const queries = useCharacterSkillLevelsForCharacters(characters)

	if (!user) {
		return (
			<Card>
				<CardContent className="py-8 text-center text-muted-foreground">
					{t('skillPlans.pleaseLogInToViewCharacterReadiness')}
				</CardContent>
			</Card>
		)
	}

	if (characters.length === 0) {
		return (
			<Card>
				<CardContent className="py-8 text-center text-muted-foreground">
					{t('skillPlans.noCharactersFoundPleaseAddCharactersToYourAccount')}
				</CardContent>
			</Card>
		)
	}

	// Check if any characters have expired tokens
	const hasExpiredTokens = characters.some((char) => !char.hasValidToken)

	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{hasExpiredTokens && (
					<div className="flex items-center gap-2 text-sm text-yellow-500 mt-2">
						<AlertCircle className="h-4 w-4" />
						{t('skillPlans.someCharactersHaveExpiredTokensProgressMayNotBeAvailable')}
					</div>
				)}
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
					{characters.map((character, index) => {
						const query = queries[index]
						const progress =
							query.data && planSkills
								? calculateCharacterProgress({
										planId,
										planName: title,
										characterId: character.characterId,
										characterName: character.characterName,
										planSkills,
										characterSkillLevels: query.data.levels,
									})
								: undefined

						// Determine loading state - show skeleton until we have data or an error
						const isLoading = planSkillsLoading || query.isPending || (!progress && !query.error)

						// Determine error state
						const hasError = !character.hasValidToken || query.error != null

						return (
							<CharacterMasteryCard
								key={character.characterId}
								characterId={character.characterId}
								characterName={character.characterName}
								planId={planId}
								progress={progress}
								isLoading={isLoading}
								error={hasError ? query.error || new Error(t('skillPlans.invalidToken')) : null}
								onClick={
									onCharacterClick ? () => onCharacterClick(character.characterId) : undefined
								}
							/>
						)
					})}
				</div>
			</CardContent>
		</Card>
	)
}
