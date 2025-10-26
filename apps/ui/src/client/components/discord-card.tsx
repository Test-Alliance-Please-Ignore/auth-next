import { AlertTriangle, CheckCircle2, MessageSquare, Shield, XCircle } from 'lucide-react'
import { useState } from 'react'

import { useDiscordLink } from '@/hooks/useDiscord'
import { apiClient } from '@/lib/api'

import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

import type { User } from '@/hooks/useAuth'

interface DiscordCardProps {
	user: User
}

/**
 * Discord account linking card component
 * Shows link button when not linked, or Discord username when linked
 */
export function DiscordCard({ user }: DiscordCardProps) {
	const { mutate: linkDiscord, isPending, linkError, clearError } = useDiscordLink()
	const [isJoiningServers, setIsJoiningServers] = useState(false)
	const [joinMessage, setJoinMessage] = useState<string | null>(null)
	const [joinError, setJoinError] = useState<string | null>(null)

	const handleLinkClick = () => {
		// Clear any previous errors before starting new link attempt
		clearError()
		linkDiscord()
	}

	const handleJoinServers = async () => {
		setIsJoiningServers(true)
		setJoinMessage(null)
		setJoinError(null)

		try {
			const result = await apiClient.joinDiscordServers()

			if (result.totalInvited > 0) {
				setJoinMessage(
					`Successfully joined ${result.totalInvited} Discord server${result.totalInvited > 1 ? 's' : ''}!`
				)
			} else if (result.results.length === 0) {
				setJoinMessage('You are not a member of any corporations with Discord servers configured.')
			} else if (result.totalFailed > 0) {
				setJoinError(
					`Failed to join ${result.totalFailed} server${result.totalFailed > 1 ? 's' : ''}. ${result.results.find((r) => !r.success)?.errorMessage ?? ''}`
				)
			}
		} catch (error) {
			console.error('Failed to join Discord servers:', error)
			setJoinError('Failed to join Discord servers. Please try again later.')
		} finally {
			setIsJoiningServers(false)
		}
	}

	return (
		<Card variant="elevated" className="h-full flex flex-col">
			<CardHeader>
				<div className="flex items-center gap-3">
					<div className="flex items-center justify-center w-12 h-12 rounded-full bg-[hsl(var(--discord-blurple))]">
						<MessageSquare className="h-6 w-6 text-white" />
					</div>
					<div>
						<CardTitle className="text-2xl">Discord</CardTitle>
						<CardDescription>
							{user.discord ? 'Connected account' : 'Link your Discord account'}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="flex-1 flex flex-col justify-center">
				{user.discord ? (
					// Linked state - show Discord username and join button
					<div className="space-y-4">
						<div className="flex items-center gap-3">
							{user.discord.authRevoked ? (
								<XCircle className="h-5 w-5 text-destructive" />
							) : (
								<CheckCircle2 className="h-5 w-5 text-green-500" />
							)}
							<div>
								<p className="font-semibold text-lg">
									{user.discord.username}
									{user.discord.discriminator !== '0' && `#${user.discord.discriminator}`}
								</p>
								<p className="text-sm text-muted-foreground">Discord ID: {user.discord.userId}</p>
							</div>
						</div>

						{/* Authorization revoked warning */}
						{user.discord.authRevoked && (
							<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
								<div className="flex items-start gap-2">
									<AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
									<div>
										<p className="text-sm text-destructive font-medium">Authorization Revoked</p>
										<p className="text-sm text-destructive/90 mt-1">
											You've removed this app from your Discord authorized apps. Please re-link your
											account to restore access.
										</p>
									</div>
								</div>
							</div>
						)}

						{/* Join servers button or Re-link button */}
						<div className="space-y-2">
							{user.discord.authRevoked ? (
								<Button
									onClick={handleLinkClick}
									disabled={isPending}
									size="sm"
									className="w-full gap-2 bg-[hsl(var(--discord-blurple))] text-white hover:bg-[hsl(var(--discord-blurple))]/90"
								>
									<MessageSquare className="h-4 w-4" />
									{isPending ? 'Opening Discord...' : 'Re-link Discord Account'}
								</Button>
							) : (
								<Button
									onClick={handleJoinServers}
									disabled={isJoiningServers}
									size="sm"
									variant="outline"
									className="w-full gap-2"
								>
									<Shield className="h-4 w-4" />
									{isJoiningServers ? 'Refreshing...' : 'Refresh Discord Access'}
								</Button>
							)}

							{/* Success message */}
							{joinMessage && (
								<p className="text-sm text-green-600 dark:text-green-400">{joinMessage}</p>
							)}

							{/* Error message */}
							{joinError && <p className="text-sm text-destructive">{joinError}</p>}
						</div>
					</div>
				) : (
					// Not linked state - show link button
					<div className="space-y-3">
						<p className="text-muted-foreground">
							Connect your Discord account to enable notifications and community features.
						</p>
						<Button
							onClick={handleLinkClick}
							disabled={isPending}
							className="w-full sm:w-auto bg-[hsl(var(--discord-blurple))] text-white hover:bg-[hsl(var(--discord-blurple))]/90"
						>
							{isPending ? 'Opening Discord...' : 'Link Discord Account'}
						</Button>
						{linkError && (
							<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
								<p className="text-sm text-destructive font-medium">Linking Failed</p>
								<p className="text-sm text-destructive/90 mt-1">{linkError}</p>
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
