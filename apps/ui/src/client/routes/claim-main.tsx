import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePageTitle } from '@/hooks/usePageTitle'
import { apiClient } from '@/lib/api'

interface CharacterInfo {
	characterOwnerHash: string
	characterId: number
	characterName: string
}

interface ClaimMainResponse {
	success: boolean
	user: {
		id: string
		mainCharacterId: number
	}
}

export default function ClaimMainPage() {
	usePageTitle('Claim Main Character')
	const location = useLocation()
	const navigate = useNavigate()
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const characterInfo = location.state?.characterInfo as CharacterInfo | undefined

	if (!characterInfo) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="text-center">
					<h1 className="text-2xl font-bold text-destructive mb-4">
						Missing Character Information
					</h1>
					<p className="text-muted-foreground mb-6">
						No character information found. Please start the login process again.
					</p>
					<Button onClick={() => navigate('/')}>Return to Home</Button>
				</div>
			</div>
		)
	}

	const handleClaimMain = async () => {
		setIsLoading(true)
		setError(null)

		try {
			// Only send characterId - server will fetch verified data from token store
			await apiClient.post<ClaimMainResponse>('/auth/claim-main', {
				characterId: characterInfo.characterId,
			})

			// Session cookie set by server, redirect to dashboard
			void navigate('/dashboard')
		} catch (err) {
			console.error('Failed to claim main:', err)
			setError('Failed to create account. Please try again.')
			setIsLoading(false)
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center p-4">
			<Card className="max-w-md w-full">
				<CardHeader>
					<CardTitle className="text-2xl">Claim Your Main Character</CardTitle>
					<CardDescription>This will be your primary character for this account</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					{/* Character Display */}
					<div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
						<img
							src={`https://images.evetech.net/characters/${characterInfo.characterId}/portrait?size=128`}
							alt={characterInfo.characterName}
							className="w-16 h-16 rounded-full border-2 border-primary"
						/>
						<div>
							<h3 className="font-semibold text-lg">{characterInfo.characterName}</h3>
							<p className="text-sm text-muted-foreground">EVE Online Character</p>
						</div>
					</div>

					{/* Info */}
					<div className="text-sm text-muted-foreground space-y-2">
						<p>
							By claiming this character as your main, you'll create a new account on Test Auth Next
							Generation.
						</p>
						<p>You can link additional characters to your account later.</p>
					</div>

					{/* Error */}
					{error && (
						<div className="p-3 bg-destructive/10 border border-destructive rounded-md">
							<p className="text-sm text-destructive">{error}</p>
						</div>
					)}

					{/* Action Button */}
					<Button
						onClick={handleClaimMain}
						disabled={isLoading}
						className="w-full cursor-pointer shadow-lg hover:shadow-xl transition-all duration-200 font-semibold"
						size="lg"
					>
						{isLoading ? 'Creating Account...' : 'Claim as Main Character'}
					</Button>

					{/* Cancel */}
					<CancelButton onClick={() => navigate('/')} disabled={isLoading} className="w-full">
						Cancel
					</CancelButton>
				</CardContent>
			</Card>
		</div>
	)
}
