import { AlertTriangle, CheckCircle2, MessageSquare, Shield, XCircle } from 'lucide-react'
import { useState } from 'react'

import { useDiscordLink } from '@/hooks/useDiscord'
import { formatNumber, useAppTranslation } from '@/i18n'
import { apiClient } from '@/lib/api'

import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

import type { User } from '@/hooks/useAuth'
import type { AppTranslationKey } from '@/i18n'
import type { DiscordRefreshOutput } from '@/lib/api'

interface RefreshMessage {
	key: AppTranslationKey
	count?: number
}

function getDiscordRefreshMessageKey(
	reason: DiscordRefreshOutput['reason'],
	partial: boolean
): AppTranslationKey {
	const messageReason =
		reason === 'authorization' || reason === 'configuration' || reason === 'temporary'
			? reason
			: 'unknown'
	return partial
		? `discordCard.partialRefreshErrors.${messageReason}`
		: `discordCard.refreshErrors.${messageReason}`
}

interface DiscordCardProps {
	user: User
}

/**
 * Discord account linking card component
 * Shows link button when not linked, or Discord username when linked
 */
export function DiscordCard({ user }: DiscordCardProps) {
	const { t } = useAppTranslation()
	const { mutate: linkDiscord, isPending, error: linkError, reset } = useDiscordLink()
	const [isJoiningServers, setIsJoiningServers] = useState(false)
	// Translate at render time so feedback also updates when the locale changes.
	const [joinMessage, setJoinMessage] = useState<RefreshMessage | null>(null)
	const [joinError, setJoinError] = useState<RefreshMessage | null>(null)
	const translateRefreshMessage = ({ key, count }: RefreshMessage) =>
		t(key, { count, formattedCount: count === undefined ? undefined : formatNumber(count) })

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
			setJoinError({ key: 'discordCard.refreshStartError' })
			setIsJoiningServers(false)
			return
		}

		try {
			const result = await apiClient.waitForDiscordRefresh(workflowInstanceId)
			const totalFailed = result.totalFailed ?? 0
			const totalInvited = result.totalInvited ?? 0

			if (result.status === 'failed') {
				setJoinError({ key: getDiscordRefreshMessageKey(result.reason, false) })
			} else if (totalFailed > 0) {
				setJoinError({
					key: getDiscordRefreshMessageKey(result.reason, true),
					count: totalFailed,
				})
			} else if (totalInvited > 0) {
				setJoinMessage({ key: 'discordCard.joined', count: totalInvited })
			} else {
				setJoinMessage({ key: 'discordCard.refreshed' })
			}
		} catch (error) {
			console.error('Failed to confirm Discord access refresh:', error)
			setJoinError({ key: 'discordCard.refreshStatusError' })
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
							{t(user.discord ? 'discordCard.connected' : 'discordCard.linkDescription')}
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
								<p className="text-sm text-muted-foreground">
									{t('discordCard.userId', { id: user.discord.userId })}
								</p>
							</div>
						</div>

						{/* Authorization revoked warning */}
						{user.discord.authRevoked && (
							<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
								<div className="flex items-start gap-2">
									<AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
									<div>
										<p className="text-sm text-destructive font-medium">
											{t('discordCard.authorizationRevoked')}
										</p>
										<p className="text-sm text-destructive/90 mt-1">
											{t('discordCard.revokedDescription')}
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
									{t(isPending ? 'discordCard.redirecting' : 'discordCard.relink')}
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
									{t(isJoiningServers ? 'discordCard.refreshing' : 'discordCard.refreshAccess')}
								</Button>
							)}

							{/* Success message */}
							{joinMessage && (
								<p className="text-sm text-green-600 dark:text-green-400">
									{translateRefreshMessage(joinMessage)}
								</p>
							)}

							{/* Error message */}
							{joinError && (
								<p className="text-sm text-destructive">{translateRefreshMessage(joinError)}</p>
							)}
						</div>
					</div>
				) : (
					// Not linked state - show link button
					<div className="space-y-3">
						<p className="text-muted-foreground">{t('discordCard.connectDescription')}</p>
						<Button
							onClick={handleLinkClick}
							disabled={isPending}
							className="w-full sm:w-auto bg-[hsl(var(--discord-blurple))] text-white hover:bg-[hsl(var(--discord-blurple))]/90"
						>
							{t(isPending ? 'discordCard.redirecting' : 'discordCard.link')}
						</Button>
						{linkError && (
							<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
								<p className="text-sm text-destructive font-medium">
									{t('discordCard.linkFailed')}
								</p>
								<p className="text-sm text-destructive/90 mt-1">
									{linkError instanceof Error ? linkError.message : t('discordCard.linkError')}
								</p>
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
