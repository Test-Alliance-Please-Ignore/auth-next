import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type CharacterRoleBadgeRole = 'main' | 'alt'

interface CharacterRoleBadgeProps {
	role: CharacterRoleBadgeRole
	className?: string
}

export function CharacterRoleBadge({ role, className }: CharacterRoleBadgeProps) {
	return (
		<Badge
			variant={role === 'main' ? 'success' : 'default'}
			className={cn('h-5 px-1.5 text-[10px] font-semibold leading-none', className)}
		>
			{role === 'main' ? 'Main' : 'Alt'}
		</Badge>
	)
}
