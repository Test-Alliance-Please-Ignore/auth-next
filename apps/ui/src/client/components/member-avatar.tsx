import { X } from 'lucide-react'

import { characterPortraitUrl } from '@/lib/eve-images'
import { cn } from '@/lib/utils'

import type { CSSProperties } from 'react'

interface MemberAvatarProps {
	characterId?: string | number
	characterName?: string | null
	size?: 'sm' | 'md' | 'lg' | 'xl' | 'auto'
	className?: string
	style?: CSSProperties
	imageSize?: 64 | 128 | 256 | 512
	isBlacklisted?: boolean
}

const sizeClasses = {
	sm: 'h-8 w-8',
	md: 'h-12 w-12',
	lg: 'h-16 w-16',
	xl: 'h-[72px] w-[72px]',
	auto: '',
}

/**
 * Reusable avatar component for displaying EVE Online character portraits
 * Handles aspect ratio preservation and provides consistent sizing across the app
 */
export function MemberAvatar({
	characterId,
	characterName,
	size = 'md',
	className,
	style,
	imageSize,
	isBlacklisted = false,
}: MemberAvatarProps) {
	const sizeClass = sizeClasses[size]
	const portraitSize = imageSize ?? 64

	return (
		<div
			className={cn(sizeClass, 'relative flex-shrink-0 overflow-hidden rounded-md', className)}
			style={style}
		>
			{characterId ? (
				<img
					src={characterPortraitUrl(characterId, portraitSize)}
					alt={characterName || 'Character portrait'}
					className={cn(
						'h-full w-full rounded-md',
						size === 'auto' ? 'object-contain' : 'object-cover',
						isBlacklisted && 'grayscale'
					)}
					loading="lazy"
				/>
			) : (
				<div className="h-full w-full rounded bg-muted flex items-center justify-center text-muted-foreground text-xs">
					?
				</div>
			)}
			{isBlacklisted && (
				<X
					className="pointer-events-none absolute inset-0 m-auto h-[78%] w-[78%] stroke-[3] text-red-500 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
					aria-hidden="true"
				/>
			)}
		</div>
	)
}
