import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { apiClient } from '@/lib/api'
import { characterPortraitUrl } from '@/lib/eve-images'

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
	const { t } = useAppTranslation()
	usePageTitle(t('claimMain.title'))
	const location = useLocation()
	const navigate = useNavigate()
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const characterInfo = location.state?.characterInfo as CharacterInfo | undefined
	const claimTicket = location.state?.claimTicket as string | undefined

	if (!characterInfo || !claimTicket) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="text-center">
					<h1 className="text-2xl font-bold text-destructive mb-4">
						{t('claimMain.missingHeading')}
					</h1>
					<p className="text-muted-foreground mb-6">{t('claimMain.missingDescription')}</p>
					<Button onClick={() => navigate('/')}>{t('claimMain.returnHome')}</Button>
				</div>
			</div>
		)
	}

	const handleClaimMain = async () => {
		setIsLoading(true)
		setError(null)

		try {
			// Send only the ticket. It names the character server-side, so the client never
			// gets to choose which character is being claimed.
			await apiClient.post<ClaimMainResponse>('/auth/claim-main', {
				claimTicket,
			})

			// Session cookie set by server, redirect to dashboard
			void navigate('/dashboard')
		} catch (err) {
			console.error('Failed to claim main:', err)
			setError(t('claimMain.failed'))
			setIsLoading(false)
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center p-4">
			<Card className="max-w-md w-full">
				<CardHeader>
					<CardTitle className="text-2xl">{t('claimMain.heading')}</CardTitle>
					<CardDescription>{t('claimMain.description')}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					{/* Character Display */}
					<div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
						<img
							src={characterPortraitUrl(characterInfo.characterId, 128)}
							alt={characterInfo.characterName}
							className="w-16 h-16 rounded-full border-2 border-primary"
						/>
						<div>
							<h3 className="font-semibold text-lg">{characterInfo.characterName}</h3>
							<p className="text-sm text-muted-foreground">{t('claimMain.character')}</p>
						</div>
					</div>

					{/* Info */}
					<div className="text-sm text-muted-foreground space-y-2">
						<p>{t('claimMain.accountExplanation')}</p>
						<p>{t('claimMain.additionalCharacters')}</p>
					</div>

					{/* Error */}
					{error && (
						<div className="p-3 bg-destructive/10 border border-destructive rounded-md">
							<p className="text-sm text-destructive">{error}</p>
						</div>
					)}

					{/* Action Button */}
					<Button
						variant="confirm"
						onClick={handleClaimMain}
						loading={isLoading}
						loadingText={t('claimMain.creating')}
						className="w-full font-semibold"
						size="lg"
					>
						{t('claimMain.claim')}
					</Button>

					{/* Cancel */}
					<Button
						variant="cancel"
						onClick={() => navigate('/')}
						disabled={isLoading}
						className="w-full"
					>
						{t('common.cancel')}
					</Button>
				</CardContent>
			</Card>
		</div>
	)
}
