/**
 * Calculates the new role set for a Discord user based on the current roles,
 * requested roles, managed roles, and the add-only mode setting.
 *
 * @param currentRoleIds - The user's current role IDs in the guild
 * @param requestedRoleIds - The role IDs that should be assigned to the user
 * @param managedRoleIds - The role IDs that are managed by the system (can be removed)
 * @param isAddOnlyMode - If true, never remove roles; if false, remove managed roles that aren't requested
 * @returns An object containing the new role set and the changes (added/removed)
 */
export function calculateRoleChanges(params: {
	currentRoleIds: string[]
	requestedRoleIds: string[]
	managedRoleIds: string[]
	isAddOnlyMode: boolean
}): {
	newRoleIds: string[]
	rolesAdded: string[]
	rolesRemoved: string[]
} {
	const { currentRoleIds, requestedRoleIds, managedRoleIds, isAddOnlyMode } = params

	// Calculate new roles based on mode:
	// - Add-only mode: merge all roles (preserve everything)
	// - Normal mode: preserve non-managed roles + add requested managed roles
	const newRoleIds = isAddOnlyMode
		? [...new Set([...currentRoleIds, ...requestedRoleIds])] // Merge + dedupe
		: (() => {
				// In normal mode: only remove managed roles, keep manually-assigned roles
				const nonManagedRoles = currentRoleIds.filter((id) => !managedRoleIds.includes(id))
				return [...new Set([...nonManagedRoles, ...requestedRoleIds])]
			})()

	// Calculate what roles are being added/removed
	const rolesAdded = newRoleIds.filter((id) => !currentRoleIds.includes(id))
	const rolesRemoved = isAddOnlyMode
		? [] // Never remove roles in add-only mode
		: currentRoleIds.filter((id) => !newRoleIds.includes(id))

	return {
		newRoleIds,
		rolesAdded,
		rolesRemoved,
	}
}

/**
 * Ensures special refresh roles are requested when the guild actually has them configured.
 * This is used for roles that should be granted by refresh but not removed during drift cleanup.
 */
export function augmentRequestedRoleIdsForRefresh(params: {
	requestedRoleIds: string[]
	guildRoleIds: string[]
	specialRoleIds: string[]
}): string[] {
	const { requestedRoleIds, guildRoleIds, specialRoleIds } = params
	if (specialRoleIds.length === 0 || guildRoleIds.length === 0) {
		return [...new Set(requestedRoleIds)]
	}

	const guildRoleSet = new Set(guildRoleIds)
	const augmented = [...requestedRoleIds]
	for (const roleId of specialRoleIds) {
		if (guildRoleSet.has(roleId)) {
			augmented.push(roleId)
		}
	}

	return [...new Set(augmented)]
}
