import { Users } from 'lucide-react'

import { CopyableMetaPill } from '@/components/copyable-meta-pill'
import { MemberAvatar } from '@/components/member-avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { CharacterIdentitySummary } from '@/features/applications/components/character-identity-summary'
import { cn } from '@/lib/utils'

export interface UserSearchCardEntry {
	summary: {
		id: string
		mainCharacterId: string
		mainCharacterName: string | null
		characterCount: number
		is_admin: boolean
		discordUserId: string | null
		discordUsername: string | null
		matchedCharacterId: string | null
		matchedCharacterName: string | null
		isBlacklisted: boolean
	}
	characters: Array<{
		characterId: string
		characterName: string
		corporationId?: string | null
		corporationName?: string | null
		allianceId?: string | null
		allianceName?: string | null
		is_primary: boolean
		hasValidToken: boolean
		isBlacklisted: boolean
	}>
}

export function formatUserDisplayName(user: UserSearchCardEntry): string {
	const mainName =
		user.summary.mainCharacterName || user.summary.matchedCharacterName || 'Unknown Character'
	const matchedName = user.summary.matchedCharacterName
	const isAltMatch =
		!!user.summary.matchedCharacterId &&
		user.summary.matchedCharacterId !== user.summary.mainCharacterId &&
		!!matchedName

	return isAltMatch ? `${matchedName} (${mainName})` : mainName
}

export function UserSearchCard({ user }: { user: UserSearchCardEntry }) {
	const displayName = formatUserDisplayName(user)
	const portraitId = user.summary.matchedCharacterId || user.summary.mainCharacterId
	const characters = [...user.characters].sort((a, b) => {
		if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
		return a.characterName.localeCompare(b.characterName)
	})
	const mainCharacterIsBlacklisted =
		user.characters.find((character) => character.characterId === user.summary.mainCharacterId)
			?.isBlacklisted ||
		user.summary.isBlacklisted ||
		false
	const displayedCharacterIsBlacklisted = user.summary.matchedCharacterId
		? (user.characters.find(
				(character) => character.characterId === user.summary.matchedCharacterId
			)?.isBlacklisted ?? false)
		: mainCharacterIsBlacklisted || false
	const accountIsBlacklisted = user.summary.isBlacklisted ?? false

	return (
		<Card
			className={cn(
				'border-border/70',
				user.summary.matchedCharacterId &&
					user.summary.matchedCharacterId !== user.summary.mainCharacterId &&
					'border-primary/30 bg-primary/5'
			)}
		>
			<CardContent className="space-y-4 pt-6">
				<div className="flex items-start gap-3">
					<MemberAvatar
						characterId={portraitId}
						characterName={displayName}
						isBlacklisted={displayedCharacterIsBlacklisted || accountIsBlacklisted}
						size="auto"
						className="h-10 w-10"
					/>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<p
								className={cn(
									'truncate text-base font-semibold',
									(displayedCharacterIsBlacklisted || accountIsBlacklisted) && 'text-red-500'
								)}
							>
								{displayName}
							</p>
							<span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
								<span className="text-white">
									{user.summary.characterCount} character
									{user.summary.characterCount !== 1 ? 's' : ''}
								</span>
							</span>
							{user.summary.is_admin && <Badge variant="default">Admin</Badge>}
							{(mainCharacterIsBlacklisted || accountIsBlacklisted) && (
								<Badge variant="destructive">Blocklisted</Badge>
							)}
							{user.summary.discordUserId && <Badge variant="success">Discord linked</Badge>}
						</div>
						<div className="mt-2 flex flex-wrap gap-2">
							<CopyableMetaPill label="User ID" value={user.summary.id} />
							{user.summary.discordUsername ? (
								<CopyableMetaPill label="Discord username" value={user.summary.discordUsername} />
							) : null}
							{user.summary.discordUserId ? (
								<CopyableMetaPill label="Discord ID" value={user.summary.discordUserId} />
							) : null}
						</div>
					</div>
				</div>

				<div className="space-y-2">
					<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						<Users className="h-3.5 w-3.5" />
						Linked Characters
					</div>
					{characters.length > 0 ? (
						<div className="space-y-2">
							{characters.map((character) => (
								<div
									key={character.characterId}
									className={cn(
										'rounded-lg border border-border/60 bg-background/80 px-3 py-2',
										user.summary.matchedCharacterId === character.characterId &&
											'border-primary/40 bg-primary/5'
									)}
								>
									<CharacterIdentitySummary
										characterId={character.characterId}
										characterName={character.characterName}
										isBlacklisted={character.isBlacklisted}
										hasAuthAccount
										hasValidToken={character.hasValidToken}
										corporationId={character.corporationId}
										corporationName={character.corporationName}
										allianceId={character.allianceId}
										allianceName={character.allianceName}
										portraitSize="sm"
										showMetrics={false}
										nameBadges={
											<>
												<Badge
													variant={character.is_primary ? 'default' : 'secondary'}
													className="px-1.5 py-0 text-[10px]"
												>
													{character.is_primary ? 'Main' : 'Alt'}
												</Badge>
												{character.isBlacklisted && (
													<Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
														Blocklisted
													</Badge>
												)}
											</>
										}
									/>
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							No linked characters were returned for this account.
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
