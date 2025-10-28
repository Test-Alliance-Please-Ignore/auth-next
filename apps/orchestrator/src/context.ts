import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string

	// Service bindings
	CORE: Fetcher & {
		getUsersForDiscordRefresh(limit?: number, refreshIntervalMinutes?: number): Promise<
			Array<{
				userId: string
				discordUserId: string
				lastDiscordRefresh: Date | null
			}>
		>
		logUserActivity(userId: string, action: string, metadata?: Record<string, any>): Promise<void>
		updateUserDiscordRefreshTimestamp(userId: string): Promise<void>
	}

	// Durable Object bindings
	DISCORD: DurableObjectNamespace
	EVE_CORPORATION_DATA: DurableObjectNamespace

	// Workflow bindings
	USER_DISCORD_REFRESH: WorkflowNamespace
}

/**
 * Workflow namespace type (from @cloudflare/workers-types)
 */
interface WorkflowNamespace {
	create(options: { id?: string; params: any }): Promise<WorkflowInstance>
	get(id: string): Promise<WorkflowInstance | null>
}

interface WorkflowInstance {
	id: string
	status(): Promise<WorkflowInstanceStatus>
	pause(): Promise<void>
	resume(): Promise<void>
	terminate(): Promise<void>
	restart(): Promise<void>
}

interface WorkflowInstanceStatus {
	status: 'running' | 'paused' | 'errored' | 'terminated' | 'complete' | 'waiting' | 'queued' | 'unknown'
	error?: string
	output?: any
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
