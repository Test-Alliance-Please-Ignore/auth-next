import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import type { BadgeVariant } from '@/components/ui/badge'
import type { HrRoleGrant, HrRoleType } from '../api'

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

const ROLE_VARIANTS: Record<HrRoleType, BadgeVariant> = {
	hr_admin: 'success',
	hr_reviewer: 'secondary',
	hr_viewer: 'ghost',
}

/**
 * HR Role Badge component
 * Displays a colored badge for an HR role with optional tooltip
 */
export function HrRoleBadge({ role, className, showTooltip = true }: HrRoleBadgeProps) {
	const { t } = useAppTranslation()
	const roleType = getRoleType(role)

	if (!roleType) {
		return null
	}

	const roleName = t(`corporations.roles.${roleType}`)
	const roleDescription = t(`corporations.hrRoleDescriptions.${roleType}`)

	return (
		<Badge
			variant={ROLE_VARIANTS[roleType]}
			className={cn(className)}
			title={showTooltip ? roleDescription : undefined}
		>
			{roleName}
		</Badge>
	)
}
