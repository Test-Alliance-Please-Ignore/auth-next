import { WorkerEntrypoint } from 'cloudflare:workers'
import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError, withSentry } from '@repo/hono-helpers'

import { inArray } from '@repo/db-utils'

import { createDb } from './db'
import { userCharacters } from './db/schema'
import { CoreDO } from './durable-object'
import { triggerDiscordRefreshWorkflow, triggerUserRefreshWorkflow } from './lib/workflow-triggers'
import { csrfProtection } from './middleware/csrf'
import { sessionMiddleware } from './middleware/session'
import adminRoutes from './routes/admin'
import authRoutes from './routes/auth'
import billsAdminRoutes from './routes/bills-admin'
import billsUserRoutes from './routes/bills-user'
import broadcastsRoutes from './routes/broadcasts'
import charactersRoutes from './routes/characters'
import corporationTaxRoutes from './routes/corporation-tax'
import corporationsRoutes from './routes/corporations'
import discordRoutes from './routes/discord'
import discordServersRoutes from './routes/discord-servers'
import dkpRoutes from './routes/dkp'
import doctrinesRoutes from './routes/doctrines'
import entitiesRoutes from './routes/entities'
import esiRoutes from './routes/esi'
import fleetsRoutes from './routes/fleets'
import freightRoutes from './routes/freight'
import groupsRoutes from './routes/groups'
import hrRoutes from './routes/hr'
import imagesRoutes from './routes/images'
import industryAdminRoutes from './routes/industry-admin'
import industryOrdersRoutes from './routes/industry-orders'
import inventoryRoutes from './routes/inventory'
import inviteRoutes from './routes/invite'
import loginRoutes from './routes/login'
import sessionRoutes from './routes/session'
import skillPlansRoutes from './routes/skill-plans'
import skillsRoutes from './routes/skills'
import srpRoutes from './routes/srp'
import usersRoutes from './routes/users'
import { CoreRpcService } from './services/core-rpc.service'
import { DkpService } from './services/dkp.service'

import type {
	CharacterOwnerInfo,
	DeleteCharacterResult,
	DeleteUserResult,
	SearchUsersParams,
	SearchUsersResult,
	TransferCharacterResult,
	UserDetails,
} from '@repo/admin'
import type { Core } from '@repo/core'
import type { App, Env } from './context'

const app = new Hono<App>()
	.use(
		'*',
		// middleware
		(c, next) =>
			useWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)

	// Session middleware - loads user into context if authenticated
	.use('*', sessionMiddleware())

	// CSRF protection - requires X-Requested-With header on state-changing API requests
	.use('/api/*', csrfProtection())

	.onError(withOnError())
	.notFound(withNotFound())

	// Health check
	.get('/', async (c) => {
		return c.json({ status: 'ok', service: 'core' })
	})

	// Public routes (for direct access and Discord embeds)
	.route('/login', loginRoutes)
	.route('/invite', inviteRoutes)

	// Public image proxy (no auth, aggressive CDN caching)
	.route('/images', imagesRoutes)

	// API routes - mounted under /api prefix
	.route('/api/admin', adminRoutes)
	.route('/api/admin/bills', billsAdminRoutes) // Admin bills API
	.route('/api/admin', industryAdminRoutes) // Admin industry API
	.route('/api/auth', authRoutes)
	.route('/api/users', usersRoutes)
	.route('/api/characters', charactersRoutes)
	.route('/api/corporation-tax', corporationTaxRoutes)
	.route('/api/corporations', corporationsRoutes)
	.route('/api/discord-servers', discordServersRoutes)
	.route('/api/dkp', dkpRoutes)
	.route('/api/doctrines', doctrinesRoutes)
	.route('/api/entities', entitiesRoutes)
	.route('/api/esi', esiRoutes)
	.route('/api/skills', skillsRoutes)
	.route('/api/skill-plans', skillPlansRoutes)
	.route('/api/discord', discordRoutes)
	.route('/api/groups', groupsRoutes)
	.route('/api/broadcasts', broadcastsRoutes)
	.route('/api/fleets', fleetsRoutes)
	.route('/api/freight', freightRoutes)
	.route('/api/inventory', inventoryRoutes)
	.route('/api/hr', hrRoutes)
	.route('/api/industry', industryOrdersRoutes)
	.route('/api/srp', srpRoutes)
	.route('/api/bills', billsUserRoutes)
	.route('/api/session', sessionRoutes)

// Export worker with HTTP and scheduled handlers
// HTTP handler is wrapped with Sentry for automatic error tracking
const sentryApp = withSentry(app)

export default {
	fetch: sentryApp.fetch.bind(sentryApp),
	async scheduled(
		_event: ScheduledEvent,
		env: Env,
		_ctx: ExecutionContext
	): Promise<void> {
		const coreStub = getStub<Core>(env.CORE, 'default')
		const result = await coreStub.processPendingDiscordRefreshes()
		if (result.processed > 0) {
			console.log('[Core:Scheduled] Processed pending Discord refreshes', result)
		}
	},
}

/**
 * Core Worker RPC Service
 * Exposes core business logic methods for other workers to call via service bindings
 */
export class CoreWorker extends WorkerEntrypoint<Env> {
	private service: CoreRpcService | null = null

	constructor(ctx: ExecutionContext, env: Env) {
		super(ctx, env)
	}

	/**
	 * Get or create the RPC service instance
	 */
	private getService(): CoreRpcService {
		if (!this.service) {
			const db = createDb(this.env.DATABASE_URL)
			this.service = new CoreRpcService(db, this.env)
		}
		return this.service
	}

	/**
	 * Search users with pagination
	 */
	async searchUsers(params: SearchUsersParams): Promise<SearchUsersResult> {
		return this.getService().searchUsers(params)
	}

	/**
	 * Get detailed user information
	 */
	async getUserDetails(userId: string): Promise<UserDetails | null> {
		return this.getService().getUserDetails(userId)
	}

	/**
	 * Delete a user and all associated data
	 */
	async deleteUser(userId: string): Promise<DeleteUserResult> {
		return this.getService().deleteUser(userId)
	}

	/**
	 * Transfer character ownership from one user to another
	 */
	async transferCharacterOwnership(
		characterId: string,
		newUserId: string
	): Promise<TransferCharacterResult> {
		return this.getService().transferCharacterOwnership(characterId, newUserId)
	}

	/**
	 * Delete/unlink a character from its owner
	 */
	async deleteCharacter(characterId: string): Promise<DeleteCharacterResult> {
		return this.getService().deleteCharacter(characterId)
	}

	/**
	 * Get character ownership information
	 */
	async getCharacterOwnership(characterId: string): Promise<CharacterOwnerInfo | null> {
		return this.getService().getCharacterOwnership(characterId)
	}

	/**
	 * Get corporations that should be included in background refresh
	 */
	async getCorporationsForBackgroundRefresh(): Promise<
		Array<{ corporationId: string; name: string }>
	> {
		return this.getService().getCorporationsForBackgroundRefresh()
	}

	/**
	 * Update the last sync timestamp for a corporation
	 */
	async updateCorporationLastSync(corporationId: string): Promise<void> {
		return this.getService().updateCorporationLastSync(corporationId)
	}

	/**
	 * Get users that have Discord linked and need refresh
	 */
	async getUsersForDiscordRefresh(
		limit = 50,
		refreshIntervalMinutes = 30
	): Promise<Array<{ userId: string; discordUserId: string; lastDiscordRefresh: Date | null }>> {
		return this.getService().getUsersForDiscordRefresh(limit, refreshIntervalMinutes)
	}

	/**
	 * Log user activity for audit trail
	 */
	async logUserActivity(
		userId: string,
		action: string,
		metadata?: Record<string, any>
	): Promise<{
		ok: boolean
		rpcRequestId: string
		method: 'logUserActivity'
		durationMs: number
		error?: { message: string; name?: string }
	}> {
		const rpcRequestId = crypto.randomUUID()
		const startedAt = Date.now()
		try {
			await this.getService().logUserActivity(userId, action, metadata)
			return {
				ok: true,
				rpcRequestId,
				method: 'logUserActivity',
				durationMs: Date.now() - startedAt,
			}
		} catch (error) {
			return {
				ok: false,
				rpcRequestId,
				method: 'logUserActivity',
				durationMs: Date.now() - startedAt,
				error: {
					message: error instanceof Error ? error.message : String(error),
					name: error instanceof Error ? error.name : undefined,
				},
			}
		}
	}

	/**
	 * Update the last Discord refresh timestamp for a user
	 */
	async updateUserDiscordRefreshTimestamp(userId: string): Promise<{
		ok: boolean
		rpcRequestId: string
		method: 'updateUserDiscordRefreshTimestamp'
		durationMs: number
		error?: { message: string; name?: string }
	}> {
		const rpcRequestId = crypto.randomUUID()
		const startedAt = Date.now()
		try {
			await this.getService().updateUserDiscordRefreshTimestamp(userId)
			return {
				ok: true,
				rpcRequestId,
				method: 'updateUserDiscordRefreshTimestamp',
				durationMs: Date.now() - startedAt,
			}
		} catch (error) {
			return {
				ok: false,
				rpcRequestId,
				method: 'updateUserDiscordRefreshTimestamp',
				durationMs: Date.now() - startedAt,
				error: {
					message: error instanceof Error ? error.message : String(error),
					name: error instanceof Error ? error.name : undefined,
				},
			}
		}
	}

	/**
	 * Sync Discord access for a user
	 * - Invites user to servers they should be in
	 * - Updates roles based on corporation/group memberships
	 * - Applies auto-apply roles
	 * - Updates nicknames if enabled
	 */
	async syncUserDiscordAccess(userId: string): Promise<{
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
	}> {
		const rpcRequestId = crypto.randomUUID()
		const startedAt = Date.now()
		try {
			const result = await this.getService().syncUserDiscordAccess(userId)
			return {
				ok: true,
				rpcRequestId,
				method: 'syncUserDiscordAccess',
				durationMs: Date.now() - startedAt,
				result,
			}
		} catch (error) {
			return {
				ok: false,
				rpcRequestId,
				method: 'syncUserDiscordAccess',
				durationMs: Date.now() - startedAt,
				error: {
					message: error instanceof Error ? error.message : String(error),
					name: error instanceof Error ? error.name : undefined,
				},
			}
		}
	}

	/**
	 * Award DKP to a character
	 */
	async awardDkp(params: {
		characterId: string
		corporationId?: string
		amount: number
		sourceType: 'fleet' | 'market' | 'mining' | 'manual' | 'adjustment'
		sourceId?: string
		sourceMetadata?: Record<string, unknown>
		awardedBy?: string
		awardReason?: string
		earnedAt?: Date
	}): Promise<{
		success: boolean
		transactionId: string
		character: {
			characterId: string
			characterName: string
			newBalance: number
		}
		corporation: {
			corporationId: string
			corporationName: string
			newBalance: number
		}
	}> {
		const db = createDb(this.env.DATABASE_URL)
		const dkpService = new DkpService(
			db,
			this.env.EVE_CORPORATION_DATA,
			this.env.EVE_CHARACTER_DATA
		)
		return dkpService.awardDkp(params)
	}

	/**
	 * Award DKP to multiple characters at once
	 */
	async awardDkpBulk(params: {
		awards: Array<{
			characterName: string
			corporationId?: string
			amount: number
			reason?: string
		}>
		globalReason: string
		sourceType?: 'fleet' | 'manual'
		sourceId?: string
		awardedBy?: string
		earnedAt?: Date
	}): Promise<{
		success: boolean
		totalAwarded: number
		transactions: Array<{
			characterName: string
			characterId: string
			transactionId: string
			amount: number
		}>
		errors: Array<{
			characterName: string
			error: string
		}>
	}> {
		const db = createDb(this.env.DATABASE_URL)
		const dkpService = new DkpService(
			db,
			this.env.EVE_CORPORATION_DATA,
			this.env.EVE_CHARACTER_DATA
		)
		return dkpService.awardDkpBulk(params)
	}

	/**
	 * Get user's main character name by user ID
	 */
	async getUserMainCharacterName(userId: string): Promise<string | null> {
		return this.getService().getUserMainCharacterName(userId)
	}

	/**
	 * Trigger a Discord refresh workflow for a single user.
	 * Used by event-driven callers (group join/leave/remove, invitation acceptance, etc.)
	 * to sync Discord roles without blocking the request.
	 */
	async triggerUserDiscordRefresh(
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
	}> {
		try {
			const result = await triggerDiscordRefreshWorkflow({
				env: this.env,
				userId,
				source: options?.source ?? 'core-rpc',
				allowRemoval: options?.allowRemoval ?? false,
			})
			return {
				success: result.triggered,
				userId,
				status: result.status,
				triggered: result.triggered,
				workflowInstanceId: result.workflowInstanceId,
				error: result.error,
			}
		} catch (error) {
			return {
				success: false,
				userId,
				status: 'failed',
				triggered: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Trigger user refresh workflow from internal callers (for example orchestrator)
	 */
	async triggerUserRefresh(
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
	}> {
		const db = createDb(this.env.DATABASE_URL)
		try {
			const result = await triggerUserRefreshWorkflow({
				db,
				env: this.env,
				userId,
				source: options?.source ?? 'core-rpc',
				bypassThrottle: options?.bypassThrottle ?? false,
				refreshMode: options?.refreshMode ?? 'scheduled',
			})
			return {
				success: result.status !== 'failed',
				userId,
				status: result.status,
				triggered: result.triggered,
				workflowInstanceId: result.workflowInstanceId,
				error: result.error,
			}
		} catch (error) {
			return {
				success: false,
				userId,
				status: 'failed',
				triggered: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Ingest character IDs for pending Discord refresh.
	 * Resolves characterIds → userIds, deduplicates, and adds to the Core DO's
	 * in-memory pending set. Processing happens on the next cron tick.
	 *
	 * Called by eve-corporation-data when corp membership changes are detected.
	 */
	async addPendingDiscordRefreshesForCharacters(
		characterIds: string[]
	): Promise<{ usersQueued: number; pendingCount: number }> {
		if (characterIds.length === 0) {
			return { usersQueued: 0, pendingCount: 0 }
		}

		const db = createDb(this.env.DATABASE_URL)

		// Batch resolve characterId → userId
		const characterUserMappings = await db
			.select({ userId: userCharacters.userId })
			.from(userCharacters)
			.where(inArray(userCharacters.characterId, characterIds))

		const uniqueUserIds = [...new Set(characterUserMappings.map((m) => m.userId))]

		if (uniqueUserIds.length === 0) {
			return { usersQueued: 0, pendingCount: 0 }
		}

		const coreStub = getStub<Core>(this.env.CORE, 'default')
		const result = await coreStub.addPendingDiscordRefreshes(uniqueUserIds)

		return { usersQueued: uniqueUserIds.length, pendingCount: result.pendingCount }
	}
}

// Export Durable Object class
// Note: Automatic Sentry instrumentation for DOs is not supported in Cloudflare Workers
// Use manual captureException() in DO methods for error tracking
export { CoreDO as Core }

// Export Workflow class
export { UserRefreshWorkflow } from './workflows/user-refresh.workflow'
export { UserDiscordRefreshWorkflow } from './workflows/user-discord-refresh.workflow'
