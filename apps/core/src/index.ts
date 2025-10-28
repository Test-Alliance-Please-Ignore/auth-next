import { WorkerEntrypoint } from 'cloudflare:workers'
import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import { createDb } from './db'
import { sessionMiddleware } from './middleware/session'
import adminRoutes from './routes/admin'
import authRoutes from './routes/auth'
import billsAdminRoutes from './routes/bills-admin'
import broadcastsRoutes from './routes/broadcasts'
import charactersRoutes from './routes/characters'
import corporationsRoutes from './routes/corporations'
import discordRoutes from './routes/discord'
import discordServersRoutes from './routes/discord-servers'
import groupsRoutes from './routes/groups'
import inviteRoutes from './routes/invite'
import loginRoutes from './routes/login'
import skillsRoutes from './routes/skills'
import usersRoutes from './routes/users'
import wsRoutes from './routes/ws'
import { CoreRpcService } from './services/core-rpc.service'

import type {
	CharacterOwnerInfo,
	DeleteCharacterResult,
	DeleteUserResult,
	SearchUsersParams,
	SearchUsersResult,
	TransferCharacterResult,
	UserDetails,
} from '@repo/admin'
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

	.onError(withOnError())
	.notFound(withNotFound())

	// Health check
	.get('/', async (c) => {
		return c.json({ status: 'ok', service: 'core' })
	})

	// Public routes (for direct access and Discord embeds)
	.route('/login', loginRoutes)
	.route('/invite', inviteRoutes)

	// API routes - mounted under /api prefix
	.route('/api/admin', adminRoutes)
	.route('/api/admin/bills', billsAdminRoutes) // Admin bills API
	.route('/api/auth', authRoutes)
	.route('/api/users', usersRoutes)
	.route('/api/characters', charactersRoutes)
	.route('/api/corporations', corporationsRoutes)
	.route('/api/discord-servers', discordServersRoutes)
	.route('/api/skills', skillsRoutes)
	.route('/api/discord', discordRoutes)
	.route('/api/groups', groupsRoutes)
	.route('/api/broadcasts', broadcastsRoutes)
	.route('/api/ws', wsRoutes)
	// .route('/api/bills', userBillsRoutes) // User bills API (TODO: implement later)

// Export Hono app as default export (HTTP handler)
export default app

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
			this.service = new CoreRpcService(db, this.env.EVE_TOKEN_STORE, this.env.DISCORD)
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
	): Promise<void> {
		return this.getService().logUserActivity(userId, action, metadata)
	}

	/**
	 * Update the last Discord refresh timestamp for a user
	 */
	async updateUserDiscordRefreshTimestamp(userId: string): Promise<void> {
		return this.getService().updateUserDiscordRefreshTimestamp(userId)
	}
}
