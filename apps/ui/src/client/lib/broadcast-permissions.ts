import type { User } from '@/hooks/useAuth'
import type { Broadcast, BroadcastTarget, UserPermission } from '@/lib/api'

const BROADCAST_GLOBAL_MANAGE_URN = 'urn:broadcasts:manage'

interface BroadcastActionVisibilityInput {
	user: User | null
	permissions: UserPermission[]
	broadcast: Pick<Broadcast, 'createdBy' | 'status'>
	target?: Pick<BroadcastTarget, 'managePermissionId'> | null
}

function getGrantedPermissionIds(permissions: UserPermission[]): Set<string> {
	const granted = new Set<string>()
	for (const permission of permissions) {
		if (typeof permission.permissionId === 'string' && permission.permissionId.length > 0) {
			granted.add(permission.permissionId)
		}
	}
	return granted
}

function hasGlobalBroadcastManage(permissions: UserPermission[]): boolean {
	return permissions.some((permission) => permission.urn === BROADCAST_GLOBAL_MANAGE_URN)
}

export function canManageBroadcastTarget(
	user: User | null,
	permissions: UserPermission[],
	target?: Pick<BroadcastTarget, 'managePermissionId'> | null
): boolean {
	if (!user) return false
	if (user.is_admin) return true
	if (hasGlobalBroadcastManage(permissions)) return true
	if (!target) return false

	return getGrantedPermissionIds(permissions).has(target.managePermissionId)
}

export function getBroadcastActionVisibility({
	user,
	permissions,
	broadcast,
	target,
}: BroadcastActionVisibilityInput): { canDelete: boolean; canRescind: boolean } {
	if (!user) {
		return { canDelete: false, canRescind: false }
	}

	const canManage = canManageBroadcastTarget(user, permissions, target)
	const isOwner = broadcast.createdBy === user.id
	const canDelete = canManage
	const canRescind = broadcast.status === 'sent' && (canManage || isOwner)

	return { canDelete, canRescind }
}
