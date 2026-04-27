import { HoverPopover } from '@/components/ui/hover-popover'
import { characterPortraitUrl } from '@/lib/eve-images'
import { cn } from '@/lib/utils'

interface CharacterRoleBadgeProps {
	role?: 'main' | 'alt'
	className?: string
	mainCharacterName?: string
	mainCharacterId?: string
}

export function CharacterRoleBadge({
	role,
	className,
	mainCharacterName,
	mainCharacterId,
}: CharacterRoleBadgeProps) {
	if (!role) return null

	const isMain = role === 'main'
	const badge = (
		<span
			className={cn(
				'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
				isMain
					? 'bg-emerald-500/15 text-emerald-400'
					: 'bg-sky-500/15 text-sky-400',
				className
			)}
		>
			{isMain ? 'Main' : 'Alt'}
		</span>
	)

	if (isMain || !mainCharacterName) return badge

	return (
		<HoverPopover
			trigger={badge}
			align="start"
			side="top"
			className="w-56 p-3"
		>
			<div className="flex items-center gap-3">
				{mainCharacterId ? (
					<img
						src={characterPortraitUrl(mainCharacterId, 64)}
						alt={mainCharacterName}
						className="h-10 w-10 rounded-full border border-border/50"
					/>
				) : (
					<div className="h-10 w-10 rounded-full border border-border/50 bg-muted" />
				)}
				<div className="min-w-0">
					<div className="text-xs text-muted-foreground">Main Character</div>
					<div className="truncate text-sm font-medium">{mainCharacterName}</div>
				</div>
			</div>
		</HoverPopover>
	)
}
