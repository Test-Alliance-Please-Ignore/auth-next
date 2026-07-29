import type { PermissionTarget } from '@repo/groups'

export function userHasPermission(
	targetType: PermissionTarget,
	isOwner: boolean,
	isAdmin: boolean
): boolean {
	switch (targetType) {
		case 'all_members':
			return true
		case 'all_admins':
			return isAdmin
		case 'owner_only':
			return isOwner
		case 'owner_and_admins':
			return isOwner || isAdmin
	}
}
