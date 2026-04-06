import type { BroadcastTarget } from '@repo/broadcasts'
import type { UserPermission } from '@repo/groups'

export type BroadcastPermissionAction = 'send' | 'manage'

interface BroadcastPermissionContext {
	grantedPermissionIds: Set<string>
	accessiblePermissionIdsByAction: Map<BroadcastPermissionAction, Set<string>>
	hasGlobalManage: boolean
}

export function buildBroadcastPermissionContext(
	userPermissions: UserPermission[]
): BroadcastPermissionContext {
	const grantedPermissionIds = new Set<string>()
	let hasGlobalManage = false
	for (const permission of userPermissions) {
		if (permission.urn === 'urn:broadcasts:manage') {
			hasGlobalManage = true
		}
		if (permission.permissionId) {
			grantedPermissionIds.add(permission.permissionId)
		}
	}

	const sendPermissionIds = new Set(grantedPermissionIds)
	const managePermissionIds = new Set(grantedPermissionIds)

	return {
		grantedPermissionIds,
		accessiblePermissionIdsByAction: new Map([
			['send', sendPermissionIds],
			['manage', managePermissionIds],
		]),
		hasGlobalManage,
	}
}

export function canAccessBroadcastPermissionId(
	permissionId: string,
	requiredAction: BroadcastPermissionAction,
	context: BroadcastPermissionContext
): boolean {
	if (context.hasGlobalManage) return true
	return context.grantedPermissionIds.has(permissionId)
}

export function canAccessBroadcastTargetByAction(
	target: Pick<BroadcastTarget, 'sendPermissionId' | 'managePermissionId'>,
	requiredAction: BroadcastPermissionAction,
	context: BroadcastPermissionContext
): boolean {
	if (requiredAction === 'manage') {
		return canAccessBroadcastPermissionId(target.managePermissionId, 'manage', context)
	}

	// Manage-level permission for a target should grant send-level access as well.
	return (
		canAccessBroadcastPermissionId(target.sendPermissionId, 'send', context) ||
		canAccessBroadcastPermissionId(target.managePermissionId, 'send', context)
	)
}

export function filterBroadcastTargetsByAction(
	targets: BroadcastTarget[],
	requiredAction: BroadcastPermissionAction,
	context: BroadcastPermissionContext
): BroadcastTarget[] {
	const seenTargetIds = new Set<string>()
	const filtered: BroadcastTarget[] = []
	const accessiblePermissionIds = context.accessiblePermissionIdsByAction.get(requiredAction)

	for (const target of targets) {
		if (
			!context.hasGlobalManage &&
			requiredAction === 'send' &&
			!(
				accessiblePermissionIds?.has(target.sendPermissionId) ||
				accessiblePermissionIds?.has(target.managePermissionId)
			)
		)
			continue
		if (
			!context.hasGlobalManage &&
			requiredAction === 'manage' &&
			!accessiblePermissionIds?.has(target.managePermissionId)
		)
			continue
		if (seenTargetIds.has(target.id)) continue
		seenTargetIds.add(target.id)
		filtered.push(target)
	}

	return filtered
}
