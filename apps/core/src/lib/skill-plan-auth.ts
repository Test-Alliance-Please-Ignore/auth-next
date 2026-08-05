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

async function hasSkillPlanPermission(
	env: GroupsEnv,
	userId: string,
	urn: string
): Promise<boolean> {
	const permissions = await getCachedUserPermissions(env, userId)
	return permissions.some((permission) => permission.urn === urn)
}

/**
 * Check if user can modify a skill plan based on maintainer ID
 * Users can modify if they are the maintainer
 * Groups members can modify if the group is the maintainer
 */
export async function canModifyPlan(
	plan: PlanForAuth,
	userId: string,
	env: GroupsEnv
): Promise<boolean> {
	// Global override: users with manage-all can modify any plan.
	if (await hasSkillPlanPermission(env, userId, 'urn:skill-plans:manage-all')) {
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
 * Maintainers can delete their plans
 */
export async function canDeletePlan(
	plan: PlanForAuth,
	userId: string,
	env: GroupsEnv
): Promise<boolean> {
	// Maintainers and users with manage-all can delete.
	return canModifyPlan(plan, userId, env)
}

/**
 * Check if user can view a skill plan
 * Published plans can be viewed by any alliance member
 * Unpublished plans require maintainer access
 */
export async function canViewPlan(
	plan: PlanForAuth,
	userId: string,
	env: GroupsEnv
): Promise<boolean> {
	// Published plans are visible to all alliance members
	if (plan.isPublished) {
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
 * Check if user can check character progress
 * Users can check any of their own characters (not just main character)
 */
export async function canCheckCharacterProgress(
	characterId: string,
	userId: string,
	db: DbClient<typeof schema>
): Promise<boolean> {
	// Check if character belongs to the user
	const { userCharacters } = await import('../db/schema')
	const userChar = await db.query.userCharacters.findFirst({
		where: eq(userCharacters.characterId, characterId),
		columns: { userId: true },
	})

	return userChar?.userId === userId
}
