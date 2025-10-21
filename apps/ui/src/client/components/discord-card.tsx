import { CheckCircle2, MessageSquare } from 'lucide-react'

import { useDiscordLink } from '@/hooks/useDiscord'

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
	const { mutate: linkDiscord, isPending, isError, error } = useDiscordLink()

	const handleLinkClick = () => {
		linkDiscord()
	}

	// Log the error for debugging
	if (error) {
		console.error('Discord linking error:', error)
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
			<CardContent className="flex-1 flex items-center">
				{user.discord ? (
					// Linked state - show Discord username
					<div className="flex items-center gap-3">
						<CheckCircle2 className="h-5 w-5 text-green-500" />
						<div>
							<p className="font-semibold text-lg">
								{user.discord.username}
								{user.discord.discriminator !== '0' && `#${user.discord.discriminator}`}
							</p>
							<p className="text-sm text-muted-foreground">Discord ID: {user.discord.userId}</p>
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
						{isError && (
							<p className="text-sm text-destructive">
								Failed to open Discord OAuth. Please allow popups and try again.
							</p>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
