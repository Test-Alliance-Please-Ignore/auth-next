import { WorkerEntrypoint } from 'cloudflare:workers'
import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError, withSentry } from '@repo/hono-helpers'

import { createDb } from './db'
import { CoreDO } from './durable-object'
import { csrfProtection } from './middleware/csrf'
import { sessionMiddleware } from './middleware/session'
import { renderFleetJoinPage } from './pages/fleet-join'
import adminRoutes from './routes/admin'
import authRoutes from './routes/auth'
import billsAdminRoutes from './routes/bills-admin'
import broadcastsRoutes from './routes/broadcasts'
import charactersRoutes from './routes/characters'
import corporationsRoutes from './routes/corporations'
import discordRoutes from './routes/discord'
import discordServersRoutes from './routes/discord-servers'
import dkpRoutes from './routes/dkp'
import doctrinesRoutes from './routes/doctrines'
import esiRoutes from './routes/esi'
import fleetsRoutes from './routes/fleets'
import freightRoutes from './routes/freight'
import groupsRoutes from './routes/groups'
import hrRoutes from './routes/hr'
import industryAdminRoutes from './routes/industry-admin'
import inventoryRoutes from './routes/inventory'
import inviteRoutes from './routes/invite'
import loginRoutes from './routes/login'
import skillPlansRoutes from './routes/skill-plans'
import skillsRoutes from './routes/skills'
import srpRoutes from './routes/srp'
import usersRoutes from './routes/users'
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

	// Fleet join page route
	.get('/fleets/join/:token', async (c) => {
		const token = c.req.param('token')
		const error = c.req.query('error')

		// Check if user is authenticated by checking session
		const sessionCookie = c.req.header('Cookie') || ''

		// Try to get the user from session
		const user = c.get('user')

		if (!user) {
			// Not authenticated - redirect to login with return URL
			const returnUrl = encodeURIComponent(`https://pleaseignore.app/fleets/join/${token}`)
			return c.redirect(`/login?return_url=${returnUrl}`)
		}

		// User is authenticated - render the join page
		return c.html(await renderFleetJoinPage(c, token, error))
	})

	// API routes - mounted under /api prefix
	.route('/api/admin', adminRoutes)
	.route('/api/admin/bills', billsAdminRoutes) // Admin bills API
	.route('/api/admin', industryAdminRoutes) // Admin industry API
	.route('/api/auth', authRoutes)
	.route('/api/users', usersRoutes)
	.route('/api/characters', charactersRoutes)
	.route('/api/corporations', corporationsRoutes)
	.route('/api/discord-servers', discordServersRoutes)
	.route('/api/dkp', dkpRoutes)
	.route('/api/doctrines', doctrinesRoutes)
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
	.route('/api/srp', srpRoutes)
// .route('/api/bills', userBillsRoutes) // User bills API (TODO: implement later)

// Export Hono app as default export (HTTP handler)
// Wrapped with Sentry for automatic error tracking
export default withSentry(app)

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
	): Promise<void> {
		return this.getService().logUserActivity(userId, action, metadata)
	}

	/**
	 * Update the last Discord refresh timestamp for a user
	 */
	async updateUserDiscordRefreshTimestamp(userId: string): Promise<void> {
		return this.getService().updateUserDiscordRefreshTimestamp(userId)
	}

	/**
	 * Sync Discord access for a user
	 * - Invites user to servers they should be in
	 * - Updates roles based on corporation/group memberships
	 * - Applies auto-apply roles
	 * - Updates nicknames if enabled
	 */
	async syncUserDiscordAccess(userId: string): Promise<{
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
	}> {
		return this.getService().syncUserDiscordAccess(userId)
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
		const { DkpService } = await import('./services/dkp.service')
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
		const { DkpService } = await import('./services/dkp.service')
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
}

// Export Durable Object class
// Note: Automatic Sentry instrumentation for DOs is not supported in Cloudflare Workers
// Use manual captureException() in DO methods for error tracking
export { CoreDO as Core }

// Export Workflow class
export { UserRefreshWorkflow } from './workflows/user-refresh.workflow'
