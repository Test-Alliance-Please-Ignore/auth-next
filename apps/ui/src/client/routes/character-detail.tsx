import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { RefreshCw, User } from 'lucide-react'
import { Navigate, useParams } from 'react-router-dom'

import { CharacterAttributes } from '../components/character-attributes'
import { CharacterCorporationHistory } from '../components/character-corporation-history'
import { CharacterPrivateInfo } from '../components/character-private-info'
import { CharacterSkillQueue } from '../components/character-skill-queue'
import { CharacterSkills } from '../components/character-skills'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { api } from '../lib/api'

export default function CharacterDetailPage() {
	const { characterId } = useParams<{ characterId: string }>()


	if (!characterId) {
		return <Navigate to="/dashboard" replace />
	}

	// Fetch character details
	const {
		data: character,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: ['character', characterId],
		queryFn: () => api.getCharacterDetail(characterId),
		enabled: !!characterId,
	})

	// Handle refresh
	const handleRefresh = async () => {
		if (!characterId) return
		try {
			await api.refreshCharacterById(characterId)
			await refetch()
		} catch (error) {
			console.error('Failed to refresh character:', error)
		}
	}

	if (!characterId) {
		return <Navigate to="/dashboard" replace />
	}

	if (isLoading) {
		return (
			<div className="container mx-auto p-8">
				<div className="space-y-4">
					<Card>
						<CardHeader>
							<div className="h-8 bg-gray-200 rounded animate-pulse w-1/3" />
						</CardHeader>
						<CardContent>
							<div className="space-y-2">
								<div className="h-4 bg-gray-200 rounded animate-pulse" />
								<div className="h-4 bg-gray-200 rounded animate-pulse w-5/6" />
								<div className="h-4 bg-gray-200 rounded animate-pulse w-2/3" />
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		)
	}

	if (error || !character) {
		return (
			<div className="container mx-auto p-8">
				<Card>
					<CardHeader>
						<CardTitle>Error</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-red-500">
							{error ? 'Failed to load character details' : 'Character not found'}
						</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	const lastUpdatedText = character.lastUpdated
		? `Updated ${formatDistanceToNow(new Date(character.lastUpdated), { addSuffix: true })}`
		: 'Never updated'

	return (
		<div className="container mx-auto p-8 space-y-6">
			{/* Character Header */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div className="flex items-center gap-4">
						<img
							src={character.public.portrait?.px128x128 || '/placeholder.png'}
							alt={character.public.info?.name}
							className="w-24 h-24 rounded"
						/>
						<div>
							<CardTitle className="text-2xl">{character.public.info?.name}</CardTitle>
							<CardDescription>
								{character.public.info?.corporationName ? (
									<span title={`Corporation ID: ${character.public.info.corporationId}`}>
										{character.public.info.corporationName}
									</span>
								) : (
									character.public.info?.corporationId && (
										<span>Corporation ID: {character.public.info.corporationId}</span>
									)
								)}
								{character.public.info?.allianceName ? (
									<span title={`Alliance ID: ${character.public.info.allianceId}`}>
										{' '}
										• {character.public.info.allianceName}
									</span>
								) : (
									character.public.info?.allianceId && (
										<span> • Alliance ID: {character.public.info.allianceId}</span>
									)
								)}
							</CardDescription>
							<p className="text-sm text-muted-foreground mt-1">{lastUpdatedText}</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{character.isOwner && (
							<Button onClick={handleRefresh} size="sm" variant="outline">
								<RefreshCw className="h-4 w-4 mr-2" />
								Refresh
							</Button>
						)}
						{character.isOwner && (
							<span className="text-sm text-green-600 font-medium flex items-center">
								<User className="h-4 w-4 mr-1" />
								Owner
							</span>
						)}
					</div>
				</CardHeader>
			</Card>

			{/* Owner-only sensitive information */}
			{character.isOwner && character.private && (
				<CharacterPrivateInfo
					location={character.private.location}
					wallet={character.private.wallet}
					assets={character.private.assets}
					status={character.private.status}
				/>
			)}

			<div className="grid gap-6 lg:grid-cols-2">
				{/* Character Attributes */}
				{character.public.attributes && (
					<CharacterAttributes attributes={character.public.attributes} />
				)}

				{/* Corporation History */}
				{character.public.corporationHistory && (
					<CharacterCorporationHistory history={character.public.corporationHistory} />
				)}
			</div>

			{/* Skill Queue (Owner only) */}
			{character.isOwner && character.private?.skillQueue && (
				<CharacterSkillQueue queue={character.private.skillQueue} />
			)}

			{/* Character Skills */}
			{character.public.skills ? (
				<CharacterSkills
					characterId={characterId || ''}
					skills={character.public.skills}
					showProgress={character.isOwner}
				/>
			) : character.isOwner ? (
				<Card>
					<CardHeader>
						<CardTitle>Skills</CardTitle>
						<CardDescription>Skill data not available</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="text-center py-8">
							<p className="text-muted-foreground mb-4">
								Skills data hasn't been fetched yet. Click the Refresh button above to load your
								character's skills.
							</p>
							<Button onClick={handleRefresh} variant="default">
								<RefreshCw className="h-4 w-4 mr-2" />
								Refresh Character Data
							</Button>
						</div>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>Skills</CardTitle>
						<CardDescription>No skill data available</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-center text-muted-foreground py-8">
							This character's skill data has not been loaded yet.
						</p>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
