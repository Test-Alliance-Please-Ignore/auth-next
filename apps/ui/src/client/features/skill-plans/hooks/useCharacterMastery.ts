import { useCharacterProgress } from '../hooks'

import type { CharacterMastery, MasteryStatus } from '../types'

/**
 * Custom hook to fetch character mastery for a specific skill plan
 * Wraps the useCharacterProgress hook and adds mastery status calculation
 */
export function useCharacterMastery(
	planId: string,
	characterId: string,
	characterName: string,
	hasValidToken: boolean = true
) {
	const { data: progress, isLoading, isPending, error } = useCharacterProgress(planId, characterId)

	// Calculate mastery status from progress data
	const getMasteryStatus = (): MasteryStatus => {
		if (!progress) return 'insufficient'

		if (progress.percentageRecommended >= 100) {
			return 'fully_trained'
		} else if (progress.percentageRequired >= 100) {
			return 'meets_minimum'
		}
		return 'insufficient'
	}

	const mastery: CharacterMastery | undefined = progress
		? {
				characterId,
				characterName,
				planId,
				status: getMasteryStatus(),
				percentageRequired: progress.percentageRequired,
				percentageRecommended: progress.percentageRecommended,
				completedRequired: progress.completedRequired,
				completedRecommended: progress.completedRecommended,
				totalSkills: progress.totalSkills,
				hasValidToken,
			}
		: undefined

	return {
		mastery,
		progress,
		// Use isPending OR no data to determine loading state
		// This prevents blank cards during initial render
		isLoading: isPending || (!progress && !error),
		error,
	}
}

/**
 * Hook to fetch mastery for multiple characters for a single skill plan
 * Useful for displaying all user characters' mastery
 */
export function useMultipleCharacterMastery(
	planId: string,
	characters: Array<{ characterId: string; characterName: string; hasValidToken: boolean }>
) {
	// Use individual queries for each character
	const queries = characters.map((char) =>
		useCharacterMastery(planId, char.characterId, char.characterName, char.hasValidToken)
	)

	return {
		masteries: queries.map((q) => q.mastery).filter(Boolean) as CharacterMastery[],
		isLoading: queries.some((q) => q.isLoading),
		errors: queries.map((q) => q.error).filter(Boolean),
	}
}
