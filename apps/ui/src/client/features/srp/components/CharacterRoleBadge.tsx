import { cn } from '@/lib/utils'

interface CharacterRoleBadgeProps {
	role?: 'main' | 'alt'
	className?: string
}

export function CharacterRoleBadge({ role, className }: CharacterRoleBadgeProps) {
	if (!role) return null

	const isMain = role === 'main'

	return (
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
}
