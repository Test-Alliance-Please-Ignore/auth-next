import type { AdminWorker as IAdminWorker } from '@repo/admin'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Groups } from '@repo/groups'
import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { Skills } from '@repo/skills'
import type { PasteWorker } from '@repo/paste'
import type { createDb } from './db'
import type { UserDiscordRefreshWorkflowParams } from './workflows/user-discord-refresh.workflow'
import type { DiscordMemberAuditWorkflowParams } from './workflows/discord-member-audit.workflow'
import type { UserRefreshWorkflowParams } from './workflows/user-refresh.workflow'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	/** Admin worker service binding (RPC) */
	ADMIN: IAdminWorker
	/** EVE Token Store Durable Object binding */
	EVE_TOKEN_STORE: DurableObjectNamespace
	/** EVE Character Data Durable Object binding */
	EVE_CHARACTER_DATA: DurableObjectNamespace
	/** EVE Corporation Data Durable Object binding */
	EVE_CORPORATION_DATA: DurableObjectNamespace
	/** Groups Durable Object binding */
	GROUPS: DurableObjectNamespace
	/** Discord Durable Object binding */
	DISCORD: DurableObjectNamespace
	/** Bills Durable Object binding */
	BILLS: DurableObjectNamespace
	/** Corporation Tax Durable Object binding */
	CORPORATION_TAX: DurableObjectNamespace
	/** Broadcasts Durable Object binding */
	BROADCASTS: DurableObjectNamespace
	/** Doctrines Durable Object binding */
	DOCTRINES: DurableObjectNamespace
	/** Fleets Durable Object binding */
	FLEETS: DurableObjectNamespace
	/** Freight Durable Object binding */
	FREIGHT: DurableObjectNamespace
	/** HR Durable Object binding */
	HR: DurableObjectNamespace
	/** Skills Durable Object binding */
	SKILLS: DurableObjectNamespace
	/** SRP (Ship Replacement Program) Durable Object binding */
	SRP: DurableObjectNamespace
	/** SRP recent-loss refresh coordinator Durable Object binding */
	SRP_RECENT_LOSS_REFRESH_COORDINATOR: DurableObjectNamespace
	/** Features Durable Object binding */
	FEATURES?: DurableObjectNamespace
	/** Universe Durable Object binding (canonical EVE static data source) */
	UNIVERSE: DurableObjectNamespace
	/** Secret for session token generation and signing */
	SESSION_SECRET: string
	/** ESI Durable Object binding */
	ESI: DurableObjectNamespace
	/** Core Durable Object binding */
	CORE: DurableObjectNamespace
	/** User Refresh Workflow binding */
	USER_REFRESH_WORKFLOW: Workflow<UserRefreshWorkflowParams>
	/** User Discord Refresh Workflow binding */
	USER_DISCORD_REFRESH_WORKFLOW: Workflow<UserDiscordRefreshWorkflowParams>
	/** Discord Member Audit Workflow binding */
	DISCORD_MEMBER_AUDIT_WORKFLOW: Workflow<DiscordMemberAuditWorkflowParams>
	/** ESI Type Resolver Durable Object binding */
	ESI_TYPE_RESOLVER: DurableObjectNamespace
	/** Industry Durable Object binding */
	INDUSTRY: DurableObjectNamespace
	/** Structures worker service binding */
	STRUCTURES: Fetcher
	/** Fulcrum (Character Reports) Durable Object binding */
	FULCRUM: DurableObjectNamespace
	/** Legacy migration Durable Object binding */
	LEGACY: DurableObjectNamespace
	/** Optional external fleets worker base URL for admin fleet monitor test page */
	FLEETS_MONITOR_BASE_URL?: string
	/** Paste worker service binding */
	PASTE: PasteWorker
	/** Moon Scan Durable Object binding */
	MOON_SCAN: DurableObjectNamespace
	/** Markets Durable Object binding */
	MARKETS: DurableObjectNamespace
	/** Legacy Auth OAuth Client ID (set as Wrangler secret) */
	LEGACY_AUTH_CLIENT_ID: string
	/** Legacy Auth OAuth Client Secret (set as Wrangler secret) */
	LEGACY_AUTH_CLIENT_SECRET: string
	/** Legacy Auth OAuth Callback URL */
	LEGACY_AUTH_CALLBACK_URL: string
	/** IP Address Hash Secret */
	IP_ADDRESS_HASH_SECRET: string
	/** Optional comma-separated Discord user IDs to exclude from member audits */
	DISCORD_AUDIT_EXCLUDED_USER_IDS?: string
	/** Shared key for trusted internal legacy-worker operations */
	LEGACY_INTERNAL_KEY?: string
}

/** Session user data attached to request context */
export interface SessionUser {
	id: string
	mainCharacterId: string
	sessionId: string
	characters: Array<{
		id: string
		characterOwnerHash: string
		characterId: string
		characterName: string
		is_primary: boolean
		hasValidToken: boolean
	}>
	is_admin: boolean
	/** Array of role URNs assigned to the user */
	roles: string[]
	/** Discord user ID (if linked). Use getDiscordStatus() to fetch full Discord profile. */
	discordUserId?: string | null
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
	/** Current authenticated user (set by session middleware) */
	user?: SessionUser
	/** EVE Token Store Durable Object stub */
	eveTokenStore?: EveTokenStore
	/** EVE Character Data Durable Object stub */
	eveCharacterData?: EveCharacterData
	/** Groups Durable Object stub */
	groupsDO?: Groups
	/** Skills Durable Object stub */
	skillsDO?: Skills
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
