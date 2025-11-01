import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { HrRoleGrant, HrRoleType } from '../api'
import { HR_ROLE_DESCRIPTIONS, HR_ROLE_NAMES } from '../api'

interface HrRoleBadgeProps {
	role: HrRoleType | HrRoleGrant | null | undefined
	className?: string
	showTooltip?: boolean
}

/**
 * Get the role type from either a string or HrRoleGrant object
 */
function getRoleType(role: HrRoleType | HrRoleGrant | null | undefined): HrRoleType | null {
	if (!role) return null
	if (typeof role === 'string') return role
	return role.role
}

/**
 * Get the color classes for an HR role
 */
function getRoleColorClasses(roleType: HrRoleType): string {
	switch (roleType) {
		case 'hr_admin':
			return 'bg-orange-500 text-white border-orange-600 hover:bg-orange-600'
		case 'hr_reviewer':
			return 'bg-blue-500 text-white border-blue-600 hover:bg-blue-600'
		case 'hr_viewer':
			return 'bg-gray-500 text-white border-gray-600 hover:bg-gray-600'
	}
}

/**
 * HR Role Badge component
 * Displays a colored badge for an HR role with optional tooltip
 */
export function HrRoleBadge({ role, className, showTooltip = true }: HrRoleBadgeProps) {
	const roleType = getRoleType(role)

	if (!roleType) {
		return null
	}

	const roleName = HR_ROLE_NAMES[roleType]
	const roleDescription = HR_ROLE_DESCRIPTIONS[roleType]
	const colorClasses = getRoleColorClasses(roleType)

	return (
		<Badge
			className={cn(colorClasses, className)}
			title={showTooltip ? roleDescription : undefined}
		>
			{roleName}
		</Badge>
	)
}
