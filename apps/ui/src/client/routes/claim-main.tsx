import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
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
	const queryClient = useQueryClient()
	const [isLoading, setIsLoading] = useState(false)
	const [isCanceling, setIsCanceling] = useState(false)
	const [claimCooldown, setClaimCooldown] = useState(3)
	const [confirmationOpen, setConfirmationOpen] = useState(false)
	const [confirmationCountdown, setConfirmationCountdown] = useState(3)
	const [error, setError] = useState<string | null>(null)

	const characterInfo = location.state?.characterInfo as CharacterInfo | undefined
	const claimTicket = location.state?.claimTicket as string | undefined

	useEffect(() => {
		const interval = window.setInterval(() => {
			setClaimCooldown((current) => {
				if (current <= 1) {
					window.clearInterval(interval)
					return 0
				}
				return current - 1
			})
		}, 1000)

		return () => window.clearInterval(interval)
	}, [])

	useEffect(() => {
		if (!confirmationOpen) return

		setConfirmationCountdown(3)
		const interval = window.setInterval(() => {
			setConfirmationCountdown((current) => {
				if (current <= 1) {
					window.clearInterval(interval)
					return 0
				}
				return current - 1
			})
		}, 1000)

		return () => window.clearInterval(interval)
	}, [confirmationOpen])

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

	const handleCancelFlow = async () => {
		if (isCanceling) return
		setConfirmationOpen(false)
		setIsCanceling(true)
		setError(null)

		try {
			await apiClient.post('/auth/claim-main/cancel', { claimTicket })
			queryClient.clear()
			window.location.assign('/')
		} catch (err) {
			console.error('Failed to cancel claim-main flow:', err)
			setError(t('claimMain.cancelFailed'))
			setIsCanceling(false)
		}
	}

	const handleConfirmNewAccount = () => {
		if (confirmationCountdown > 0 || isLoading || isCanceling) return
		setConfirmationOpen(false)
		void handleClaimMain()
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

					<div className="rounded-lg border-l-2 border-destructive bg-destructive/10 p-4">
						<p className="font-semibold text-destructive">{t('claimMain.warningTitle')}</p>
						<p className="mt-2 text-sm leading-6 text-foreground">
							{t('claimMain.warningDescription')}
						</p>
						<p className="mt-2 text-lg font-bold leading-7 text-destructive">
							{t('claimMain.warningConsequence')}
						</p>
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
						onClick={() => setConfirmationOpen(true)}
						disabled={claimCooldown > 0 || isLoading || isCanceling}
						loading={isLoading}
						loadingText={t('claimMain.creating')}
						className="w-full font-semibold"
						size="lg"
					>
						{claimCooldown > 0
							? t('claimMain.claimWait', { count: claimCooldown })
							: t('claimMain.claim')}
					</Button>

					{/* Cancel */}
					<Button
						variant="cancel"
						onClick={() => void handleCancelFlow()}
						disabled={isLoading || isCanceling}
						loading={isCanceling}
						loadingText={t('claimMain.canceling')}
						className="w-full"
					>
						{t('claimMain.cancel')}
					</Button>
				</CardContent>
			</Card>

			<Dialog
				open={confirmationOpen}
				onOpenChange={(open) => {
					if (!open) void handleCancelFlow()
				}}
			>
				<DialogContent className="border-2 border-destructive/60">
					<DialogHeader>
						<DialogTitle className="text-xl font-bold text-destructive">
							{t('claimMain.confirmationTitle')}
						</DialogTitle>
						<DialogDescription className="text-base leading-6">
							{t('claimMain.confirmationDescription')}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 text-base leading-6">
						<p className="font-bold text-foreground">{t('claimMain.confirmationWarning')}</p>
						<p className="text-muted-foreground">{t('claimMain.confirmationExistingAccount')}</p>
						<p className="rounded-md border-2 border-warning/50 bg-warning/10 p-3 font-bold text-destructive">
							{t('claimMain.confirmationReadCarefully')}
						</p>
					</div>
					<DialogFooter>
						<Button
							variant="cancel"
							showIcon={false}
							disabled={isLoading || isCanceling}
							onClick={() => void handleCancelFlow()}
						>
							{t('claimMain.cancelAndLogin')}
						</Button>
						<Button
							variant="confirm"
							showIcon={false}
							disabled={confirmationCountdown > 0 || isLoading || isCanceling}
							onClick={handleConfirmNewAccount}
						>
							{confirmationCountdown > 0
								? t('claimMain.confirmationWait', { count: confirmationCountdown })
								: t('claimMain.confirmNewAccount')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
