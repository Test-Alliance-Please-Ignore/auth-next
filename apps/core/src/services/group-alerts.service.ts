import { and, inArray, isNotNull } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import {
	buildGroupApplicationSubmittedMessage,
	buildGroupInvitationMessage,
} from '../lib/group-alerts'
import { getPrimaryCharacterSummaryByUserId } from '../lib/user-character-lookup'

import type { Discord } from '@repo/discord'
import type { Groups } from '@repo/groups'
import type { MessageContent } from '@repo/discord'
import type { DbClient } from '../db'
import * as schema from '../db/schema'
import type { Env } from '../context'

type DispatchResult = {
	recipientCount: number
	sentCount: number
	skippedCount: number
	failedCount: number
}

async function getDiscordLinkedUserIds(
	db: DbClient<typeof schema>,
	userIds: string[]
): Promise<string[]> {
	const normalized = [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))]
	if (normalized.length === 0) {
		return []
	}

	const rows = await db.query.users.findMany({
		where: and(inArray(schema.users.id, normalized), isNotNull(schema.users.discordUserId)),
		columns: {
			id: true,
		},
	})

	return rows.map((row) => row.id)
}

async function sendToRecipients(
	discordStub: Discord,
	recipientUserIds: string[],
	message: MessageContent
): Promise<Pick<DispatchResult, 'sentCount' | 'failedCount'>> {
	if (recipientUserIds.length === 0) {
		return { sentCount: 0, failedCount: 0 }
	}

	const results = await Promise.allSettled(
		recipientUserIds.map(async (userId) => discordStub.sendDirectMessage(userId, message))
	)

	let sentCount = 0
	let failedCount = 0
	for (const result of results) {
		if (result.status === 'fulfilled' && result.value.success) {
			sentCount += 1
		} else {
			failedCount += 1
		}
	}

	return { sentCount, failedCount }
}

export async function dispatchGroupApplicationSubmittedAlert(
	env: Env,
	db: DbClient<typeof schema>,
	input: {
		groupId: string
		groupName: string
		applicationId: string
		applicantUserId: string
		applicationNote: string | null
		submittedAt: Date
	}): Promise<DispatchResult> {
	const groupsStub = getStub<Groups>(env.GROUPS, 'default')
	const discordStub = getStub<Discord>(env.DISCORD, 'default')

	const [recipientUserIds, applicant] = await Promise.all([
		groupsStub.getGroupOwnerAndAdminUserIds(input.groupId),
		getPrimaryCharacterSummaryByUserId(db, input.applicantUserId),
	])

	const linkedRecipientUserIds = await getDiscordLinkedUserIds(db, recipientUserIds)
	if (linkedRecipientUserIds.length === 0) {
		return {
			recipientCount: recipientUserIds.length,
			sentCount: 0,
			skippedCount: recipientUserIds.length,
			failedCount: 0,
		}
	}

	const message = buildGroupApplicationSubmittedMessage({
		groupId: input.groupId,
		groupName: input.groupName,
		applicantCharacterId: applicant?.characterId ?? input.applicantUserId,
		applicantCharacterName: applicant?.characterName ?? 'Unknown character',
		applicationNote: input.applicationNote,
		submittedAt: input.submittedAt,
	})

	const { sentCount, failedCount } = await sendToRecipients(
		discordStub,
		linkedRecipientUserIds,
		message
	)

	return {
		recipientCount: recipientUserIds.length,
		sentCount,
		skippedCount: recipientUserIds.length - linkedRecipientUserIds.length,
		failedCount,
	}
}

export async function dispatchGroupInvitationAlert(
	env: Env,
	db: DbClient<typeof schema>,
	input: {
		groupId: string
		groupName: string
		invitationId: string
		inviterUserId: string
		inviteeUserId: string
		createdAt: Date
	}): Promise<DispatchResult> {
	const discordStub = getStub<Discord>(env.DISCORD, 'default')
	const [inviteeRecipients, inviter] = await Promise.all([
		getDiscordLinkedUserIds(db, [input.inviteeUserId]),
		getPrimaryCharacterSummaryByUserId(db, input.inviterUserId),
	])

	if (inviteeRecipients.length === 0) {
		return {
			recipientCount: 1,
			sentCount: 0,
			skippedCount: 1,
			failedCount: 0,
		}
	}

	const message = buildGroupInvitationMessage({
		groupId: input.groupId,
		groupName: input.groupName,
		invitationId: input.invitationId,
		inviterCharacterName: inviter?.characterName ?? 'Unknown character',
		createdAt: input.createdAt,
	})

	const { sentCount, failedCount } = await sendToRecipients(
		discordStub,
		inviteeRecipients,
		message
	)

	return {
		recipientCount: inviteeRecipients.length,
		sentCount,
		skippedCount: 0,
		failedCount,
	}
}
