import type { HrRoleType } from '../../hr/api'

type CorporationAccessRole =
	| 'CEO'
	| 'Director'
	| 'admin'
	| 'hr_admin'
	| 'hr_reviewer'
	| 'hr_viewer'
	| null

interface ApplicationActionRoleInput {
	isSiteAdmin: boolean
	corporationRole: CorporationAccessRole | undefined
	permissionRole: HrRoleType | null | undefined
}

/** Resolve the role used by the application action panel. */
export function resolveApplicationActionRole({
	isSiteAdmin,
	corporationRole,
	permissionRole,
}: ApplicationActionRoleInput): HrRoleType | null {
	if (isSiteAdmin || corporationRole === 'admin') return 'hr_admin'
	return (
		permissionRole ??
		(corporationRole === 'hr_admin' ||
		corporationRole === 'hr_reviewer' ||
		corporationRole === 'hr_viewer'
			? corporationRole
			: null)
	)
}
