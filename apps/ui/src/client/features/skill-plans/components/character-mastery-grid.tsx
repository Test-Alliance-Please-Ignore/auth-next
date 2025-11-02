import { useQueries } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { CharacterMasteryCard } from './character-mastery-card'
import { skillPlanKeys } from '../hooks'
import { skillPlansApi } from '../api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle } from 'lucide-react'
import type { MasteryStatus } from '../types'

interface CharacterMasteryGridProps {
	planId: string
	title?: string
	onCharacterClick?: (characterId: string) => void
}

export function CharacterMasteryGrid({ planId, title = 'Character Readiness', onCharacterClick }: CharacterMasteryGridProps) {
	const { user } = useAuth()

	// Get all user characters
	const characters = user?.characters || []

	// Use useQueries to fetch data for all characters in parallel
	// This is the proper way to handle dynamic arrays of queries
	const queries = useQueries({
		queries: characters.map((char) => ({
			queryKey: skillPlanKeys.progress(planId, char.characterId),
			queryFn: () => skillPlansApi.checkCharacterProgress(planId, char.characterId),
			staleTime: 1000 * 60 * 1, // 1 minute
			enabled: !!planId && !!char.characterId,
			// Disable cache to ensure loading states always show
			gcTime: 0,
			// Notify only when status changes to reduce re-renders
			notifyOnChangeProps: ['data', 'error', 'status'],
		})),
	})

	if (!user) {
		return (
			<Card>
				<CardContent className="py-8 text-center text-muted-foreground">
					Please log in to view character readiness.
				</CardContent>
			</Card>
		)
	}

	if (characters.length === 0) {
		return (
			<Card>
				<CardContent className="py-8 text-center text-muted-foreground">
					No characters found. Please add characters to your account.
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
						Some characters have expired tokens. Progress may not be available.
					</div>
				)}
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
					{characters.map((character, index) => {
						const query = queries[index]
						const progress = query.data

						// Determine loading state - show skeleton until we have data or an error
						const isLoading = query.isPending || (!progress && !query.error)

						// Debug logging
						console.log(`[CharacterMasteryGrid] ${character.characterName}:`, {
							isPending: query.isPending,
							isFetching: query.isFetching,
							hasData: !!progress,
							hasError: !!query.error,
							isLoading,
							hasValidToken: character.hasValidToken
						})

						// Determine error state
						const hasError = !character.hasValidToken || query.error !== null

						return (
							<CharacterMasteryCard
								key={character.characterId}
								characterId={character.characterId}
								characterName={character.characterName}
								planId={planId}
								progress={progress}
								isLoading={isLoading}
								error={hasError ? (query.error || new Error('Invalid token')) : null}
								onClick={onCharacterClick ? () => onCharacterClick(character.characterId) : undefined}
							/>
						)
					})}
				</div>
			</CardContent>
		</Card>
	)
}