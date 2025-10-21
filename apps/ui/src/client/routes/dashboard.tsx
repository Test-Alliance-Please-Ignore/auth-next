import { ExternalLink, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { DiscordCard } from '@/components/discord-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { apiClient } from '@/lib/api'

export default function DashboardPage() {
	const { user, isLoading, refetch } = useAuth()
	const navigate = useNavigate()
	const [isLinkingCharacter, setIsLinkingCharacter] = useState(false)
	const [refreshingCharacters, setRefreshingCharacters] = useState<Set<string>>(new Set())

	const handleRefreshCharacter = async (characterId: number) => {
		// Prevent multiple refreshes for the same character
		const characterIdStr = characterId.toString()
		if (refreshingCharacters.has(characterIdStr)) return

		// Add character to refreshing set
		setRefreshingCharacters((prev) => new Set(prev).add(characterIdStr))

		try {
			const result = await apiClient.refreshCharacterById(characterId)

			if (result.success) {
				// Refresh user data to get updated character info
				await refetch()
				console.log('Character refreshed successfully')
			}
		} catch (error) {
			console.error('Failed to refresh character:', error)
			// TODO: Show error toast
		} finally {
			// Remove character from refreshing set
			setRefreshingCharacters((prev) => {
				const next = new Set(prev)
				next.delete(characterIdStr)
				return next
			})
		}
	}

	const handleLinkCharacter = async () => {
		setIsLinkingCharacter(true)
		try {
			// Start character linking flow
			const response = await apiClient.post<{ authorizationUrl: string; state: string }>(
				'/auth/character/start'
			)

			// Redirect to EVE SSO for character authorization
			window.location.href = response.authorizationUrl
		} catch (error) {
			console.error('Failed to start character linking flow:', error)
			setIsLinkingCharacter(false)
			// TODO: Show error toast
		}
	}

	if (isLoading) {
		return <LoadingPage label="Loading dashboard..." />
	}

	if (!user) {
		navigate('/')
		return null
	}

	// Find main character
	const mainCharacter = user.characters.find((c) => c.characterId === user.mainCharacterId)

	return (
		<div className="min-h-screen">
			<div className="container mx-auto px-4 py-8 max-w-6xl">
				{/* Header */}
				<div className="mb-8">
					<h1 className="text-4xl md:text-5xl font-bold mb-2">Dashboard</h1>
					<p className="text-muted-foreground">Manage your characters and connections</p>
				</div>

				{/* Main Character and Discord Cards Row */}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
					{/* Main Character Card - 75% width on desktop */}
					<div className="md:col-span-2 lg:col-span-3">
						<Card className="card-gradient border-border/50 shadow-[0_8px_30px_rgb(0,0,0,0.4)] relative h-full">
							<CardHeader>
								<CardTitle className="text-xl md:text-2xl">Main Character</CardTitle>
								<CardDescription>Your primary EVE Online character</CardDescription>
							</CardHeader>
							<CardContent>
								{mainCharacter ? (
									<>
										<div className="flex items-center gap-4">
											<img
												src={`https://images.evetech.net/characters/${mainCharacter.characterId}/portrait?size=128`}
												alt={`${mainCharacter.characterName}'s portrait`}
												loading="lazy"
												onError={(e) => {
													e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"%3E%3Crect fill="%23404040" width="128" height="128"/%3E%3Ctext x="50%25" y="50%25" font-family="Arial" font-size="48" fill="%23bfbfbf" text-anchor="middle" dominant-baseline="middle"%3E?%3C/text%3E%3C/svg%3E'
												}}
												className="w-20 h-20 rounded-full border-2 border-primary/30 glow shadow-lg"
											/>
											<div className="flex-1">
												<h3 className="text-xl font-semibold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
													{mainCharacter.characterName}
												</h3>
												<p className="text-sm text-muted-foreground">
													Character ID: {mainCharacter.characterId}
												</p>
											</div>
											<Link to={`/character/${mainCharacter.characterId}`}>
												<Button size="sm" variant="outline" className="gap-2">
													View Details
													<ExternalLink className="h-3 w-3" />
												</Button>
											</Link>
										</div>
										<Button
											size="icon"
											variant="ghost"
											className="absolute top-4 right-4 hover:bg-primary/10 h-11 w-11"
											onClick={() => handleRefreshCharacter(mainCharacter.characterId)}
											disabled={refreshingCharacters.has(mainCharacter.characterId.toString())}
											aria-label={`Refresh ${mainCharacter.characterName} character data`}
										>
											<RefreshCw
												className={`h-4 w-4 ${
													refreshingCharacters.has(mainCharacter.characterId.toString())
														? 'animate-spin'
														: ''
												}`}
											/>
										</Button>
									</>
								) : (
									<p className="text-muted-foreground">No main character found</p>
								)}
							</CardContent>
						</Card>
					</div>

					{/* Discord Card - 25% width on desktop */}
					<div className="md:col-span-2 lg:col-span-1">
						<DiscordCard user={user} />
					</div>
				</div>

				{/* Linked Characters */}
				<div className="mb-8">
					<div className="flex justify-between items-center mb-4">
						<h2 className="text-2xl md:text-3xl font-bold gradient-text">Linked Characters</h2>
						<Button
							variant="outline"
							className="glow-hover border-border/50 bg-muted/50 hover:bg-muted"
							onClick={handleLinkCharacter}
							disabled={isLinkingCharacter}
						>
							{isLinkingCharacter ? 'Redirecting...' : 'Link New Character'}
						</Button>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{user.characters.map((character) => (
							<Card
								key={character.characterId}
								className="card-gradient border-border/30 hover:border-primary/30 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.3)] group relative"
							>
								<CardContent className="p-4">
									<Link to={`/character/${character.characterId}`} className="block">
										<div className="flex items-center gap-3">
											<img
												src={`https://images.evetech.net/characters/${character.characterId}/portrait?size=64`}
												alt={`${character.characterName}'s portrait`}
												loading="lazy"
												onError={(e) => {
													e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"%3E%3Crect fill="%23404040" width="64" height="64"/%3E%3Ctext x="50%25" y="50%25" font-family="Arial" font-size="24" fill="%23bfbfbf" text-anchor="middle" dominant-baseline="middle"%3E?%3C/text%3E%3C/svg%3E'
												}}
												className="w-12 h-12 rounded-full border border-border/50 group-hover:border-primary/30 transition-colors shadow-md"
											/>
											<div className="flex-1 min-w-0">
												<h3 className="font-semibold truncate group-hover:text-primary transition-colors">
													{character.characterName}
												</h3>
												{character.characterId === user.mainCharacterId && (
													<span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">
														Main
													</span>
												)}
											</div>
										</div>
									</Link>
									<Button
										size="icon"
										variant="ghost"
										className="absolute top-2 right-2 h-11 w-11 hover:bg-primary/10"
										onClick={() => handleRefreshCharacter(character.characterId)}
										disabled={refreshingCharacters.has(character.characterId.toString())}
										aria-label={`Refresh ${character.characterName} character data`}
									>
										<RefreshCw
											className={`h-4 w-4 ${
												refreshingCharacters.has(character.characterId.toString())
													? 'animate-spin'
													: ''
											}`}
										/>
									</Button>
								</CardContent>
							</Card>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}
