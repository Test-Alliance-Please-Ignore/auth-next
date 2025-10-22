interface MemberAvatarProps {
	characterId?: number
	characterName?: string | null
	size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
	sm: 'h-8 w-8',
	md: 'h-12 w-12',
	lg: 'h-16 w-16',
}

/**
 * Reusable avatar component for displaying EVE Online character portraits
 * Handles aspect ratio preservation and provides consistent sizing across the app
 */
export function MemberAvatar({ characterId, characterName, size = 'md' }: MemberAvatarProps) {
	const sizeClass = sizeClasses[size]

	return (
		<div className={`${sizeClass} flex-shrink-0`}>
			{characterId ? (
				<img
					src={`https://images.evetech.net/characters/${characterId}/portrait?size=64`}
					alt={characterName || 'Character portrait'}
					className="h-full w-full rounded object-cover"
					loading="lazy"
				/>
			) : (
				<div className="h-full w-full rounded bg-muted flex items-center justify-center text-muted-foreground text-xs">
					?
				</div>
			)}
		</div>
	)
}
