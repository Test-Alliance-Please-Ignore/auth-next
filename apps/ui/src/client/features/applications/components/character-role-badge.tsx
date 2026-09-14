import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

export type CharacterRoleBadgeRole = 'main' | 'alt'

interface CharacterRoleBadgeProps {
	role: CharacterRoleBadgeRole
	className?: string
}

export function CharacterRoleBadge({ role, className }: CharacterRoleBadgeProps) {
	const { t } = useAppTranslation()

	return (
		<Badge
			variant={role === 'main' ? 'success' : 'default'}
			className={cn('h-5 px-1.5 text-[10px] font-semibold leading-none', className)}
		>
			{t(role === 'main' ? 'common.characterIdentity.main' : 'common.characterIdentity.alt')}
		</Badge>
	)
}
