import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'

import type { Env } from '../../../context'

export type MemberIds = Awaited<ReturnType<typeof esiFetch.fetchMembers>>

export interface StoreMembersResult {
	stored: number
	departedMemberIds: string[]
	addedMemberIds: string[]
}

export async function fetchMembers(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<MemberIds> {
	const tokenStore = createTokenStore(env)
	const members = await esiFetch.fetchMembers(tokenStore, corporationId, directorCharacterId)

	logger.debug('[MembersStep] Fetched members', { corporationId, count: members.length })

	return members
}

export async function storeMembers(
	env: Env,
	corporationId: string,
	memberIds: MemberIds
): Promise<StoreMembersResult> {
	const corpData = getCorporationDataStub(env, corporationId)
	const result = await corpData.storeMembers(corporationId, memberIds)

	logger.info('[MembersStep] Stored members', {
		corporationId,
		total: memberIds.length,
		departed: result.departedMemberIds.length,
		added: result.addedMemberIds.length,
	})

	return {
		stored: memberIds.length,
		departedMemberIds: result.departedMemberIds,
		addedMemberIds: result.addedMemberIds,
	}
}

/**
 * Notify Core worker of members that need Discord refresh.
 */
export async function sendMembershipChangedMessages(
	env: Env,
	_corporationId: string,
	memberIds: string[]
): Promise<void> {
	if (memberIds.length === 0) {
		return
	}

	await env.CORE.handleCharacterAffiliationChanges(memberIds, {
		source: 'corp-membership-changed',
		bypassThrottle: true,
	})

	logger.info('[MembersStep] Membership changes sent to Core for unified affiliation handling', {
		count: memberIds.length,
	})
}
