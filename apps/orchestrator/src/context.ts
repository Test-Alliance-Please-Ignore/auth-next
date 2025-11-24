import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from '@repo/orchestrator'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string

	SHOULD_REFRESH_CORPORATION_DATA: boolean
	SHOULD_REFRESH_USER_DISCORD: boolean

	// Service bindings
	CORE: Fetcher & {
		getUsersForDiscordRefresh(
			limit?: number,
			refreshIntervalMinutes?: number
		): Promise<
			Array<{
				userId: string
				discordUserId: string
				lastDiscordRefresh: Date | null
			}>
		>
		logUserActivity(userId: string, action: string, metadata?: Record<string, any>): Promise<void>
		updateUserDiscordRefreshTimestamp(userId: string): Promise<void>
		syncUserDiscordAccess(userId: string): Promise<{
			results: Array<{
				guildId: string
				guildName: string
				corporationName?: string
				groupName?: string
				success: boolean
				errorMessage?: string
				alreadyMember?: boolean
				type?: 'corporation' | 'group'
				operation?: 'invite' | 'update'
			}>
			totalInvited: number
			totalUpdated: number
			totalFailed: number
		}>
	}

	// Durable Object bindings
	DISCORD: DurableObjectNamespace
	EVE_CORPORATION_DATA: DurableObjectNamespace

	// Workflow bindings
	USER_DISCORD_REFRESH: Workflow
	EVE_CORPORATION_SYNC: Workflow
	USER_REFRESH_WORKFLOW: Workflow
	CORE_DURABLE_OBJECT: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
