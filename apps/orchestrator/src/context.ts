import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from '@repo/orchestrator'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string

	SHOULD_REFRESH_CORPORATION_DATA: boolean
	SHOULD_REFRESH_USER_DISCORD: boolean
	SHOULD_REFRESH_USER_REFRESH: boolean

	// Service bindings
	CORE: Fetcher & {
		triggerUserDiscordRefresh(
			userId: string,
			options?: {
				source?: string
				allowRemoval?: boolean
			}
		): Promise<{
			success: boolean
			userId: string
			status: 'triggered' | 'failed'
			triggered: boolean
			workflowInstanceId?: string
			error?: string
		}>

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
		logUserActivity(
			userId: string,
			action: string,
			metadata?: Record<string, any>
		): Promise<{
			ok: boolean
			rpcRequestId: string
			method: 'logUserActivity'
			durationMs: number
			error?: { message: string; name?: string }
		}>
		updateUserDiscordRefreshTimestamp(userId: string): Promise<{
			ok: boolean
			rpcRequestId: string
			method: 'updateUserDiscordRefreshTimestamp'
			durationMs: number
			error?: { message: string; name?: string }
		}>
		syncUserDiscordAccess(userId: string): Promise<{
			ok: boolean
			rpcRequestId: string
			method: 'syncUserDiscordAccess'
			durationMs: number
			result?: {
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
			}
			error?: { message: string; name?: string }
		}>
		triggerUserRefresh(
			userId: string,
			options?: {
				source?: string
				bypassThrottle?: boolean
				refreshMode?: 'scheduled' | 'event' | 'manual'
			}
		): Promise<{
			success: boolean
			userId: string
			status: 'triggered' | 'throttled' | 'failed'
			triggered: boolean
			workflowInstanceId?: string
			error?: string
		}>
	}
	EVE_CORPORATION_DATA: Fetcher & {
		triggerCorporationSyncBatch(
			corporationIds: string[],
			trigger?: 'cron' | 'api'
		): Promise<{
			total: number
			created: number
			failed: number
			workflows: Array<{
				corporationId: string
				success: boolean
				workflowId?: string
				error?: string
			}>
		}>
	}

	// Durable Object bindings
	DISCORD: DurableObjectNamespace
	EVE_CORPORATION_DATA_DO: DurableObjectNamespace

	// Workflow bindings
	USER_DISCORD_REFRESH: Workflow
	CORE_DO: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
