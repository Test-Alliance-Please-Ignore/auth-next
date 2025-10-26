import { Crown, ShieldCheck, Users } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

import type { PermissionTarget } from '@/lib/api'

interface PermissionTargetBadgeProps {
	target: PermissionTarget
	size?: 'sm' | 'md'
}

const targetConfig = {
	all_members: {
		label: 'All Members',
		variant: 'default' as const,
		icon: Users,
		description: 'Every member of the group',
	},
	all_admins: {
		label: 'All Admins',
		variant: 'secondary' as const,
		icon: ShieldCheck,
		description: 'All group administrators',
	},
	owner_only: {
		label: 'Owner Only',
		variant: 'destructive' as const,
		icon: Crown,
		description: 'Only the group owner',
	},
	owner_and_admins: {
		label: 'Owner & Admins',
		variant: 'outline' as const,
		icon: ShieldCheck,
		description: 'Group owner and all admins',
	},
} as const

export function PermissionTargetBadge({ target, size = 'md' }: PermissionTargetBadgeProps) {
	const { label, variant, icon: Icon } = targetConfig[target]

	return (
		<Badge variant={variant} className={size === 'sm' ? 'text-xs' : ''}>
			<Icon className={size === 'sm' ? 'w-3 h-3 mr-1' : 'w-4 h-4 mr-1.5'} />
			{label}
		</Badge>
	)
}

// Export the config for use in other components
export { targetConfig }

// Helper to get target description for preview text
export function getTargetDescription(target: PermissionTarget): string {
	return targetConfig[target].description.toLowerCase()
}
