import { WorkflowEntrypoint } from 'cloudflare:workers'

import { and, eq, inArray } from '@repo/db-utils'
import { DISCORD_EXCLUDED_NITRO_BOOSTER_ROLE_ID, getDiscordStub } from '@repo/discord'

import { createDb } from '../db'
import { discordMemberAuditRows, discordMemberAuditRuns, userCharacters, users } from '../db/schema'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Env } from '../context'

export interface DiscordMemberAuditWorkflowParams {
	runId: string
	discordServerId: string
	guildId: string
	guildName: string
}

type AuditMemberRowInsert = typeof discordMemberAuditRows.$inferInsert
const EXCLUDED_AUDIT_ROLE_IDS = new Set([DISCORD_EXCLUDED_NITRO_BOOSTER_ROLE_ID])

function parseExcludedDiscordUserIds(raw: string | undefined): Set<string> {
	if (!raw) return new Set()
	return new Set(
		raw
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean)
	)
}

export class DiscordMemberAuditWorkflow extends WorkflowEntrypoint<
	Env,
	DiscordMemberAuditWorkflowParams
> {
	async run(
		event: WorkflowEvent<DiscordMemberAuditWorkflowParams>,
		step: WorkflowStep
	): Promise<{ status: 'completed' | 'failed'; runId: string; scanned: number }> {
		const { runId, guildId } = event.payload
		const db = createDb(this.env.DATABASE_URL)
		const discordStub = getDiscordStub(this.env)
		const excludedDiscordUserIds = parseExcludedDiscordUserIds(this.env.DISCORD_AUDIT_EXCLUDED_USER_IDS)

		await step.do('mark-processing', async () => {
			await db
				.update(discordMemberAuditRuns)
				.set({
					status: 'processing',
					updatedAt: new Date(),
				})
				.where(eq(discordMemberAuditRuns.id, runId))
		})

		try {
			await step.do('clear-existing-rows', async () => {
				await db.delete(discordMemberAuditRows).where(eq(discordMemberAuditRows.runId, runId))
			})

			let cursor: string | undefined
			let totalScanned = 0
			let linkedCount = 0
			let unlinkedCount = 0
			let page = 0

			while (true) {
				page++
				const chunk = await step.do(
					`fetch-members-page-${page}`,
					{ timeout: '2 minutes', retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' } },
					async () =>
						discordStub.listGuildMembers(guildId, {
							limit: 1000,
							afterDiscordUserId: cursor,
						})
				)

				if (chunk.length === 0) break
				const sanitizedMembers = chunk
					.filter((member) => !member.isBot && !excludedDiscordUserIds.has(member.discordUserId))
					.map((member) => ({
						...member,
						roleIds: (member.roleIds ?? []).filter((roleId) => !EXCLUDED_AUDIT_ROLE_IDS.has(roleId)),
					}))
				const filteredMembers = sanitizedMembers.filter((member) => (member.roleIds?.length ?? 0) > 0)
				totalScanned += filteredMembers.length
				cursor = chunk[chunk.length - 1]?.discordUserId

				const discordIds = filteredMembers.map((m) => m.discordUserId).filter(Boolean)
				const linkedUsers =
					discordIds.length > 0
						? await db.query.users.findMany({
								where: inArray(users.discordUserId, discordIds),
								columns: { id: true, discordUserId: true, mainCharacterId: true },
							})
						: []
				const linkedByDiscordId = new Map(
					linkedUsers.filter((u) => !!u.discordUserId).map((u) => [u.discordUserId as string, u])
				)

				const linkedUserIds = linkedUsers.map((u) => u.id)
				const primaryChars =
					linkedUserIds.length > 0
						? await db.query.userCharacters.findMany({
								where: and(inArray(userCharacters.userId, linkedUserIds), eq(userCharacters.is_primary, true)),
								columns: {
									userId: true,
									characterId: true,
									characterName: true,
									hasValidToken: true,
									corporationId: true,
									corporationName: true,
								},
							})
						: []
				const primaryByUserId = new Map(primaryChars.map((ch) => [ch.userId, ch]))

				const rows: AuditMemberRowInsert[] = filteredMembers.map((member) => {
					const linkedUser = linkedByDiscordId.get(member.discordUserId)
					const primary = linkedUser ? primaryByUserId.get(linkedUser.id) : undefined
					const linked = !!linkedUser
					if (linked) linkedCount += 1
					else unlinkedCount += 1

					return {
						runId,
						discordUserId: member.discordUserId,
						username: member.username,
						discriminator: member.discriminator,
						displayName: member.displayName,
						roleIds: member.roleIds,
						linked,
						coreUserId: linkedUser?.id ?? null,
						mainCharacterId: primary?.characterId ?? linkedUser?.mainCharacterId ?? null,
						mainCharacterName: primary?.characterName ?? null,
						hasValidToken: primary?.hasValidToken ?? null,
						corporationId: primary?.corporationId ?? null,
						corporationName: primary?.corporationName ?? null,
					}
				})

				if (rows.length > 0) {
					await db
						.insert(discordMemberAuditRows)
						.values(rows)
						.onConflictDoNothing()
				}

				await db
					.update(discordMemberAuditRuns)
					.set({
						scanned: totalScanned,
						linkedCount,
						unlinkedCount,
						updatedAt: new Date(),
					})
					.where(eq(discordMemberAuditRuns.id, runId))

				if (chunk.length < 1000) break
			}

			await step.do('mark-completed', async () => {
				await db
					.update(discordMemberAuditRuns)
					.set({
						status: 'completed',
						scanned: totalScanned,
						linkedCount,
						unlinkedCount,
						completedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(discordMemberAuditRuns.id, runId))
			})

			return { status: 'completed', runId, scanned: totalScanned }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			await step.do('mark-failed', async () => {
				await db
					.update(discordMemberAuditRuns)
					.set({
						status: 'failed',
						errorMessage: message,
						completedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(discordMemberAuditRuns.id, runId))
			})
			return { status: 'failed', runId, scanned: 0 }
		}
	}
}
