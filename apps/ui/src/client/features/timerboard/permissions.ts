import { TIMERBOARD_PERMISSION_URNS } from '@repo/core'

export { TIMERBOARD_PERMISSION_URNS }

type PermissionLike = string | { urn: string }

function hasPermission(permissions: readonly PermissionLike[], urn: string): boolean {
	return permissions.some((permission) =>
		typeof permission === 'string' ? permission === urn : permission.urn === urn
	)
}

export function canViewTimerboard(
	permissions: readonly PermissionLike[],
	isSiteAdmin: boolean
): boolean {
	return (
		isSiteAdmin ||
		hasPermission(permissions, TIMERBOARD_PERMISSION_URNS.view) ||
		hasPermission(permissions, TIMERBOARD_PERMISSION_URNS.edit) ||
		hasPermission(permissions, TIMERBOARD_PERMISSION_URNS.manage)
	)
}

export function canEditTimerboard(
	permissions: readonly PermissionLike[],
	isSiteAdmin: boolean
): boolean {
	return (
		isSiteAdmin ||
		hasPermission(permissions, TIMERBOARD_PERMISSION_URNS.edit) ||
		hasPermission(permissions, TIMERBOARD_PERMISSION_URNS.manage)
	)
}
