import { AlertTriangle, CheckCircle2, MessageSquare, Shield, XCircle } from 'lucide-react'
import { useState } from 'react'

import { useDiscordLink } from '@/hooks/useDiscord'
import { apiClient } from '@/lib/api'

import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

import type { User } from '@/hooks/useAuth'

function getDiscordRefreshMessage(
	reason: 'authorization' | 'configuration' | 'temporary' | 'unknown' | undefined,
	partial: boolean
): string {
	if (reason === 'authorization') {
		return partial ? 'Some access needs Discord authorization' : 'Discord authorization may need renewal'
	}
	if (reason === 'configuration') {
		return partial ? 'Some access has a server configuration issue' : 'Discord server configuration issue'
	}
	if (reason === 'temporary') {
		return partial ? 'Some access affected by a temporary Discord issue' : 'Discord temporarily unavailable'
	}
	return partial ? 'Some Discord access could not be updated' : 'Discord access update incomplete'
}

interface DiscordCardProps {
	user: User
}

/**
 * Discord account linking card component
 * Shows link button when not linked, or Discord username when linked
 */
export function DiscordCard({ user }: DiscordCardProps) {
	const { mutate: linkDiscord, isPending, error: linkError, reset } = useDiscordLink()
	const [isJoiningServers, setIsJoiningServers] = useState(false)
	const [joinMessage, setJoinMessage] = useState<string | null>(null)
	const [joinError, setJoinError] = useState<string | null>(null)

	const handleLinkClick = () => {
		// Clear any previous errors before starting new link attempt
		reset()
		linkDiscord()
	}

	const handleJoinServers = async () => {
		setIsJoiningServers(true)
		setJoinMessage(null)
		setJoinError(null)

		let workflowInstanceId: string
		try {
			workflowInstanceId = (await apiClient.joinDiscordServers()).workflowInstanceId
		} catch (error) {
			console.error('Failed to start Discord access refresh:', error)
			setJoinError('We could not start the Discord access refresh. Please try again later.')
			setIsJoiningServers(false)
			return
		}

		try {
			const result = await apiClient.waitForDiscordRefresh(workflowInstanceId)
			const totalFailed = result.totalFailed ?? 0
			const totalInvited = result.totalInvited ?? 0

			if (result.status === 'failed') {
				setJoinError(getDiscordRefreshMessage(result.reason, false))
			} else if (totalFailed > 0) {
				setJoinError(`${getDiscordRefreshMessage(result.reason, true)} (${totalFailed} server${totalFailed > 1 ? 's' : ''}).`)
			} else if (totalInvited > 0) {
				setJoinMessage(
					`Successfully joined ${totalInvited} Discord server${totalInvited > 1 ? 's' : ''}!`
				)
			} else {
				setJoinMessage('Discord access refreshed successfully.')
			}
		} catch (error) {
			console.error('Failed to confirm Discord access refresh:', error)
			setJoinError('Discord access status could not be confirmed')
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
									{isPending ? 'Redirecting to Discord...' : 'Re-link Discord Account'}
								</Button>
							) : (
								<Button
									onClick={handleJoinServers}
									disabled={isJoiningServers}
									size="sm"
									variant="ghost"
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
							{isPending ? 'Redirecting to Discord...' : 'Link Discord Account'}
						</Button>
						{linkError && (
							<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
								<p className="text-sm text-destructive font-medium">Linking Failed</p>
								<p className="text-sm text-destructive/90 mt-1">
									{linkError instanceof Error ? linkError.message : 'An error occurred'}
								</p>
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
