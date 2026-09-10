import { Crown, ShieldCheck, Users } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { i18n, useAppTranslation } from '@/i18n'

import type { PermissionTarget } from '@/lib/api'

interface PermissionTargetBadgeProps {
	target: PermissionTarget
	size?: 'sm' | 'md'
}

const targetConfig = {
	all_members: {
		labelKey: 'groups.permissions.targets.all_members',
		variant: 'default' as const,
		icon: Users,
		descriptionKey: 'groups.permissions.targetDescriptions.all_members',
	},
	all_admins: {
		labelKey: 'groups.permissions.targets.all_admins',
		variant: 'success' as const,
		icon: ShieldCheck,
		descriptionKey: 'groups.permissions.targetDescriptions.all_admins',
	},
	owner_only: {
		labelKey: 'groups.permissions.targets.owner_only',
		variant: 'destructive' as const,
		icon: Crown,
		descriptionKey: 'groups.permissions.targetDescriptions.owner_only',
	},
	owner_and_admins: {
		labelKey: 'groups.permissions.targets.owner_and_admins',
		variant: 'warning' as const,
		icon: ShieldCheck,
		descriptionKey: 'groups.permissions.targetDescriptions.owner_and_admins',
	},
} as const

export function PermissionTargetBadge({ target, size = 'md' }: PermissionTargetBadgeProps) {
	const { t } = useAppTranslation()
	const { labelKey, variant, icon: Icon } = targetConfig[target]

	return (
		<Badge variant={variant} className={size === 'sm' ? 'text-xs' : ''}>
			<Icon className={size === 'sm' ? 'w-3 h-3 mr-1' : 'w-4 h-4 mr-1.5'} />
			{t(labelKey)}
		</Badge>
	)
}

// Export the config for use in other components
export { targetConfig }

// Helper to get target description for preview text
export function getTargetDescription(target: PermissionTarget): string {
	return i18n.t(targetConfig[target].descriptionKey)
}
