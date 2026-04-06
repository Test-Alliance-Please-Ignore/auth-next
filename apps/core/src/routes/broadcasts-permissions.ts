import type { BroadcastTarget } from '@repo/broadcasts'
import type { PermissionWithDetails, UserPermission } from '@repo/groups'

export type BroadcastPermissionAction = 'send' | 'manage'

interface BroadcastPermissionMetadata {
	entity: string
	target: string
	action: BroadcastPermissionAction
}

interface BroadcastPermissionContext {
	permissionMetaById: Map<string, BroadcastPermissionMetadata>
	userActionsByKey: Map<string, Set<BroadcastPermissionAction>>
	hasGlobalManage: boolean
}

const BROADCAST_URN_PATTERN = /^urn:broadcasts:([a-z0-9_-]+):([a-z0-9_-]+):(send|manage)$/

function parseBroadcastPermissionUrn(urn: string): BroadcastPermissionMetadata | null {
	const match = BROADCAST_URN_PATTERN.exec(urn)
	if (!match) return null
	return {
		entity: match[1],
		target: match[2],
		action: match[3] as BroadcastPermissionAction,
	}
}

function makePermissionKey(meta: Pick<BroadcastPermissionMetadata, 'entity' | 'target'>): string {
	return `${meta.entity}:${meta.target}`
}

export function buildBroadcastPermissionContext(
	userPermissions: UserPermission[],
	globalPermissions: PermissionWithDetails[]
): BroadcastPermissionContext {
	const permissionMetaById = new Map<string, BroadcastPermissionMetadata>()
	for (const permission of globalPermissions) {
		const meta = parseBroadcastPermissionUrn(permission.urn)
		if (meta) {
			permissionMetaById.set(permission.id, meta)
		}
	}

	const userActionsByKey = new Map<string, Set<BroadcastPermissionAction>>()
	let hasGlobalManage = false
	for (const permission of userPermissions) {
		if (permission.urn === 'urn:broadcasts:manage') {
			hasGlobalManage = true
		}
		const meta = parseBroadcastPermissionUrn(permission.urn)
		if (!meta) continue
		const key = makePermissionKey(meta)
		if (!userActionsByKey.has(key)) {
			userActionsByKey.set(key, new Set())
		}
		userActionsByKey.get(key)!.add(meta.action)
	}

	return { permissionMetaById, userActionsByKey, hasGlobalManage }
}

export function canAccessBroadcastPermissionId(
	permissionId: string,
	requiredAction: BroadcastPermissionAction,
	context: BroadcastPermissionContext
): boolean {
	if (context.hasGlobalManage) return true

	const meta = context.permissionMetaById.get(permissionId)
	if (!meta) return false

	const key = makePermissionKey(meta)
	const userActions = context.userActionsByKey.get(key)
	if (!userActions) return false

	if (requiredAction === 'send') {
		return userActions.has('send') || userActions.has('manage')
	}

	return userActions.has('manage')
}

export function filterBroadcastTargetsByAction(
	targets: BroadcastTarget[],
	requiredAction: BroadcastPermissionAction,
	context: BroadcastPermissionContext
): BroadcastTarget[] {
	const seenTargetIds = new Set<string>()
	const filtered: BroadcastTarget[] = []

	for (const target of targets) {
		const requiredPermissionId =
			requiredAction === 'manage' ? target.managePermissionId : target.sendPermissionId
		if (!canAccessBroadcastPermissionId(requiredPermissionId, requiredAction, context)) continue
		if (seenTargetIds.has(target.id)) continue
		seenTargetIds.add(target.id)
		filtered.push(target)
	}

	return filtered
}
