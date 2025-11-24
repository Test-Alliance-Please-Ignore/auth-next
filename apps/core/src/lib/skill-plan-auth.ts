import { eq } from '@repo/db-utils'

import { getCachedUserMemberships, getCachedUserPermissions } from './groups-cache'

import type { SkillPlan, SkillPlanSummary } from '@repo/skills'
import type { DbClient, schema } from '../db'

// Type that includes the fields we need for authorization
type PlanForAuth = Pick<SkillPlan | SkillPlanSummary, 'maintainerId' | 'isPublished'>

/**
 * Environment type that includes GROUPS binding
 */
type GroupsEnv = {
	GROUPS: DurableObjectNamespace
}

/**
 * Check if a user has a specific skill plan permission
 */
export async function hasSkillPlanPermission(
	env: GroupsEnv,
	userId: string,
	permissionUrn: string,
	isAdmin: boolean
): Promise<boolean> {
	// Site admins bypass all permission checks
	if (isAdmin) {
		return true
	}

	const permissions = await getCachedUserPermissions(env, userId)
	return permissions.some((p) => p.urn === permissionUrn)
}

/**
 * Check if user can create skill plans
 */
export async function canCreateSkillPlan(
	env: GroupsEnv,
	userId: string,
	isAdmin: boolean
): Promise<boolean> {
	return hasSkillPlanPermission(env, userId, 'urn:skill-plans:create', isAdmin)
}

/**
 * Check if user can modify a skill plan based on maintainer ID
 * Site admins can always modify any plan
 * Users can modify if they are the maintainer
 * Groups members can modify if the group is the maintainer
 */
export async function canModifyPlan(
	plan: PlanForAuth,
	userId: string,
	env: GroupsEnv,
	isAdmin: boolean
): Promise<boolean> {
	// Site admins can ALWAYS modify any plan
	if (isAdmin) {
		return true
	}

	// Users with manage-all permission
	if (await hasSkillPlanPermission(env, userId, 'urn:skill-plans:manage-all', false)) {
		return true
	}

	// Check if maintainer is the user
	if (plan.maintainerId === userId) {
		return true
	}

	// Check if maintainer is a group and user is a member
	if (plan.maintainerId?.startsWith('group:')) {
		const groupId = plan.maintainerId.replace('group:', '')
		const memberships = await getCachedUserMemberships(env, userId)
		return memberships.some((m) => m.groupId === groupId)
	}

	return false
}

/**
 * Check if user can delete a skill plan
 * Site admins can always delete any plan
 * Maintainers can delete their plans
 * Users with delete-any permission can delete any plan
 */
export async function canDeletePlan(
	plan: PlanForAuth,
	userId: string,
	env: GroupsEnv,
	isAdmin: boolean
): Promise<boolean> {
	// Site admins can always delete
	if (isAdmin) {
		return true
	}

	// Check for delete-any permission
	if (await hasSkillPlanPermission(env, userId, 'urn:skill-plans:delete-any', false)) {
		return true
	}

	// Otherwise, check if user can modify (maintainer check)
	return canModifyPlan(plan, userId, env, false)
}

/**
 * Check if user can view a skill plan
 * Published plans can be viewed by any authenticated user
 * Private plans require maintainer access or view-private permission
 */
export async function canViewPlan(
	plan: PlanForAuth,
	userId: string,
	env: GroupsEnv,
	isAdmin: boolean
): Promise<boolean> {
	// Published plans are visible to all authenticated users
	if (plan.isPublished) {
		return true
	}

	// Site admins can view all plans
	if (isAdmin) {
		return true
	}

	// Check for view-private permission
	if (await hasSkillPlanPermission(env, userId, 'urn:skill-plans:view-private', false)) {
		return true
	}

	// Check if user is the maintainer
	if (plan.maintainerId === userId) {
		return true
	}

	// Check if maintainer is a group and user is a member
	if (plan.maintainerId?.startsWith('group:')) {
		const groupId = plan.maintainerId.replace('group:', '')
		const memberships = await getCachedUserMemberships(env, userId)
		return memberships.some((m) => m.groupId === groupId)
	}

	return false
}

/**
 * Check if user can manage skill plan categories
 * Only admins or users with categories:manage permission
 */
export async function canManageCategories(
	env: GroupsEnv,
	userId: string,
	isAdmin: boolean
): Promise<boolean> {
	return hasSkillPlanPermission(env, userId, 'urn:skill-plans:categories:manage', isAdmin)
}

/**
 * Check if user can create skill plan categories
 * Admins or users with categories:create permission
 */
export async function canCreateCategory(
	env: GroupsEnv,
	userId: string,
	isAdmin: boolean
): Promise<boolean> {
	return hasSkillPlanPermission(env, userId, 'urn:skill-plans:categories:create', isAdmin)
}

/**
 * Check if user can check character progress
 * Users can check any of their own characters (not just main character)
 * Admins or users with progress:check-any can check any character
 */
export async function canCheckCharacterProgress(
	characterId: string,
	userId: string,
	db: DbClient<typeof schema>,
	env: GroupsEnv,
	isAdmin: boolean
): Promise<boolean> {
	// Admins can check any character
	if (isAdmin) {
		return true
	}

	// Check if user has check-any permission
	const hasCheckAny = await hasSkillPlanPermission(
		env,
		userId,
		'urn:skill-plans:progress:check-any',
		false
	)
	if (hasCheckAny) {
		return true
	}

	// Check if character belongs to the user (not just main character)
	const { userCharacters } = await import('../db/schema')
	const userChar = await db.query.userCharacters.findFirst({
		where: eq(userCharacters.characterId, characterId),
		columns: { userId: true },
	})

	return userChar?.userId === userId
}
