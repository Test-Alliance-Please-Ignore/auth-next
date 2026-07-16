import { WorkerEntrypoint } from 'cloudflare:workers'
import { Hono } from 'hono'

import { and, eq, inArray, ne } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import {
	captureException,
	logger,
	withWorkerLogContext,
	withNotFound,
	withOnError,
	withSentry,
	withWorkersLogger,
} from '@repo/hono-helpers'

import { createDb } from './db'
import { discordMemberAuditRuns, userCharacters, userIpAddresses, users } from './db/schema'
import { CoreDO } from './durable-object'
import { cleanupExpiredExportArtifacts } from './lib/export-retention'
import { waitUntilWithTelemetry } from './lib/background-task'
import { IMMUNITAS_ALERT_DRAIN_CRON } from './lib/immunitas-alerts'
import { TOKEN_INVALID_ALERT_DRAIN_CRON } from './lib/token-invalid-alerts'
import { getStructureAssetsDebugBucket } from './lib/structure-assets-debug'
import { triggerDiscordRefreshWorkflow, triggerUserRefreshWorkflow } from './lib/workflow-triggers'
import { csrfProtection } from './middleware/csrf'
import { sessionMiddleware } from './middleware/session'
import adminRoutes from './routes/admin'
import adminNavigationLinksRoutes from './routes/admin/navigation-links'
import adminStructuresRoutes from './routes/admin/structures'
import authRoutes from './routes/auth'
import billsAdminRoutes from './routes/bills-admin'
import billsUserRoutes from './routes/bills-user'
import broadcastsRoutes from './routes/broadcasts'
import charactersRoutes from './routes/characters'
import corporationTaxRoutes from './routes/corporation-tax'
import corporationsRoutes from './routes/corporations'
import discordRoutes from './routes/discord'
import discordCommandsRoutes from './routes/discord-commands'
import discordServersRoutes from './routes/discord-servers'
import dkpRoutes from './routes/dkp'
import doctrinesRoutes from './routes/doctrines'
import entitiesRoutes from './routes/entities'
import esiRoutes from './routes/esi'
import flagsRoutes from './routes/flags'
import fleetsRoutes from './routes/fleets'
import freightRoutes from './routes/freight'
import fulcrumRoutes from './routes/fulcrum'
import groupsRoutes from './routes/groups'
import hrRoutes from './routes/hr'
import imagesRoutes from './routes/images'
import industryAdminRoutes from './routes/industry-admin'
import industryOrdersRoutes from './routes/industry-orders'
import inventoryRoutes from './routes/inventory'
import inviteRoutes from './routes/invite'
import loginRoutes from './routes/login'
import { moonScanRoutes } from './routes/moon-scan'
import mumbleRoutes from './routes/mumble'
import mumbleTempopRoutes from './routes/mumble-tempop'
import publicMumbleTempopRoutes from './routes/mumble-tempop-public'
import navigationLinksRoutes from './routes/navigation-links'
import oauthRoutes from './routes/oauth'
import { handleOAuthDevProxyRequest, isOAuthDevProxyPath } from './routes/oauth-dev-proxy'
import pastesRoutes, { publicPasteRoutes } from './routes/pastes'
import predictionMarketsRoutes from './routes/prediction-markets'
import predictionMarketsAdminRoutes from './routes/prediction-markets-admin'
import servicesAuditRoutes from './routes/services-audit'
import sessionRoutes from './routes/session'
import skillPlansRoutes from './routes/skill-plans'
import skillsRoutes from './routes/skills'
import srpRoutes from './routes/srp'
import publicSrpRoutes from './routes/srp-public'
import structuresRoutes from './routes/structures'
import universeRoutes from './routes/universe'
import usersRoutes from './routes/users'
import { CoreRpcService } from './services/core-rpc.service'
import {
	buildDiscordInteractionRouting,
	ensureDiscordCommandRegistryLoaded,
	executeDiscordSlashCommand,
} from './services/discord-commands.service'
import {
	executeDiscordComponent,
	executeDiscordModalSubmit,
} from './services/discord-components.service'
import { reconcileMarketPosts } from './services/discord-market-reconcile.service'
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
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Hr } from '@repo/hr'
import type { Legacy } from '@repo/legacy'
import type { App, Env } from './context'
import type {
	DiscordInteractionRouting,
	ExecuteDiscordSlashCommandInput,
} from './services/discord-commands.service'
import type {
	ExecuteComponentInput,
	ExecuteModalSubmitInput,
} from './services/discord-components.service'

const app = new Hono<App>()
	.use(
		'*',
		(c, next) =>
			withWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)

	// Dev-only OAuth issuer proxy for local client harnesses.
	.use('*', async (c, next) => {
		if (c.env.ENVIRONMENT === 'development' && isOAuthDevProxyPath(new URL(c.req.url).pathname)) {
			return await handleOAuthDevProxyRequest(c)
		}
		return await next()
	})

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
	.route('/api/public/paste', publicPasteRoutes)
	.route('/api/public/mumble-tempop', publicMumbleTempopRoutes)
	.route('/api/public/srp', publicSrpRoutes)

	// API routes - mounted under /api prefix
	.route('/api/admin', adminRoutes)
	.route('/api/admin/structures', adminStructuresRoutes)
	.route('/api/admin/navigation', adminNavigationLinksRoutes)
	.route('/api/admin/bills', billsAdminRoutes) // Admin bills API
	.route('/api/admin/prediction-markets', predictionMarketsAdminRoutes) // Admin prediction-markets API
	.route('/api/admin', industryAdminRoutes) // Admin industry API
	.route('/api/auth', authRoutes)
	.route('/api/users', usersRoutes)
	.route('/api/universe', universeRoutes)
	.route('/api/characters', charactersRoutes)
	.route('/api/corporation-tax', corporationTaxRoutes)
	.route('/api/corporations', corporationsRoutes)
	.route('/api/discord-servers', discordServersRoutes)
	.route('/api/services-audit', servicesAuditRoutes) // Read-only service access audit (admin)
	.route('/api/discord-commands', discordCommandsRoutes)
	.route('/api/dkp', dkpRoutes)
	.route('/api/doctrines', doctrinesRoutes)
	.route('/api/prediction-markets', predictionMarketsRoutes) // Member prediction-markets API (create)
	.route('/api/entities', entitiesRoutes)
	.route('/api/esi', esiRoutes)
	.route('/api/skills', skillsRoutes)
	.route('/api/skill-plans', skillPlansRoutes)
	.route('/api/discord', discordRoutes)
	.route('/api/groups', groupsRoutes)
	.route('/api/broadcasts', broadcastsRoutes)
	.route('/api/fleets', fleetsRoutes)
	.route('/api/freight', freightRoutes)
	.route('/api/fulcrum', fulcrumRoutes)
	.route('/api/inventory', inventoryRoutes)
	.route('/api/hr', hrRoutes)
	.route('/api/oauth', oauthRoutes)
	.route('/api/industry', industryOrdersRoutes)
	.route('/api/flags', flagsRoutes)
	.route('/api/srp', srpRoutes)
	.route('/api/moon-scan', moonScanRoutes)
	.route('/api/structures', structuresRoutes)
	.route('/api/navigation', navigationLinksRoutes)
	.route('/api/mumble', mumbleRoutes)
	.route('/api/mumble-tempop', mumbleTempopRoutes)
	.route('/api/bills', billsUserRoutes)
	.route('/api/session', sessionRoutes)
	.route('/api/pastes', pastesRoutes)

// Export worker with HTTP and scheduled handlers
// HTTP handler is wrapped with Sentry for automatic error tracking
const sentryApp = withSentry(app)

export default {
	fetch: sentryApp.fetch.bind(sentryApp),
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		await withWorkerLogContext('core-scheduled', env, async () => {
			const scheduledLogger = logger.withTags({ component: 'core-scheduled' })
			const coreStub = getStub<Core>(env.CORE, 'default')
			if (event.cron === '3-58/5 * * * *') {
				const result = await coreStub.processPendingDiscordRefreshes()
				if (result.processed > 0) {
					scheduledLogger.info('[Core:Scheduled] Processed pending Discord refreshes', result)
				}

				const tempopResult = await coreStub.processExpiredTempops()
				if (tempopResult.expired > 0) {
					scheduledLogger.info('[Core:Scheduled] Expired Mumble temp-ops', tempopResult)
				}

				// Prediction-markets forum-post drift sweep: auto-close due markets + refresh/backfill
				// posts. Best-effort and out-of-band so a slow Discord run never delays the cron; a real
				// failure is paged, not swallowed.
				ctx.waitUntil(
					reconcileMarketPosts(createDb(env.DATABASE_URL), env)
						.then((r) => {
							if (r.closed > 0 || r.refreshed > 0 || r.posted > 0 || r.notified > 0 || r.failed > 0) {
								scheduledLogger.info('[Core:Scheduled] Prediction-market reconcile', r)
							}
						})
						.catch((error) => captureException(error as Error, { tags: { job: 'pm-reconcile' } }))
				)

				ctx.waitUntil(
					cleanupExpiredExportArtifacts(getStructureAssetsDebugBucket(env), 'structure-assets-debug').catch(
						(error) => captureException(error as Error, { tags: { job: 'structure-assets-debug-cleanup' } })
					)
				)
			}

			if (event.cron === TOKEN_INVALID_ALERT_DRAIN_CRON) {
				const tokenAlertResult = await coreStub.processPendingTokenInvalidationAlerts()
				if (tokenAlertResult.processed > 0) {
					scheduledLogger.info(
						'[Core:Scheduled] Processed pending token invalidation alerts',
						tokenAlertResult
					)
				}
			}

			if (event.cron === IMMUNITAS_ALERT_DRAIN_CRON) {
				const immunitasAlertResult = await coreStub.processPendingImmunitasAccessAlerts()
				if (immunitasAlertResult.processed > 0) {
					scheduledLogger.info(
						'[Core:Scheduled] Processed pending immunitas access alerts',
						immunitasAlertResult
					)
				}
			}

			// Daily full cleanup of Discord member audit history at midnight UTC.
			if (event.cron === '0 0 * * *') {
				const db = createDb(env.DATABASE_URL)
				const deletedRuns = await db
					.delete(discordMemberAuditRuns)
					.returning({ id: discordMemberAuditRuns.id })
				if (deletedRuns.length > 0) {
					scheduledLogger.info('[Core:Scheduled] Deleted Discord member audit runs', {
						count: deletedRuns.length,
					})
				}
			}
		})
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
		const db = createDb(env.DATABASE_URL)
		waitUntilWithTelemetry(
			ctx,
			'core.command-registry-warm',
			() => ensureDiscordCommandRegistryLoaded(db),
			{}
		)
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
	 * Get all linked character IDs for a user.
	 */
	async getUserCharacterIds(userId: string): Promise<string[]> {
		return this.getService().getUserCharacterIds(userId)
	}

	/**
	 * List a page of users that currently have at least one active linked character.
	 */
	async listUsersWithActiveCharactersPage(input: { limit: number; offset: number }): Promise<{
		users: Array<{ userId: string; characterIds: string[] }>
		totalCount: number
	}> {
		return this.getService().listUsersWithActiveCharactersPage(input)
	}

	/**
	 * List every core user that currently has at least one active linked character.
	 */
	async listUsersWithActiveCharacters(): Promise<
		Array<{ userId: string; characterIds: string[] }>
	> {
		const db = createDb(this.env.DATABASE_URL)
		const rows = await db.query.userCharacters.findMany({
			columns: {
				userId: true,
				characterId: true,
			},
			where: (table, { eq }) => eq(table.isDeleted, false),
		})

		const perUser = new Map<string, string[]>()
		for (const row of rows) {
			const bucket = perUser.get(row.userId) ?? []
			bucket.push(row.characterId)
			perUser.set(row.userId, bucket)
		}

		return [...perUser.entries()].map(([userId, characterIds]) => ({ userId, characterIds }))
	}

	/**
	 * Get user batches for the daily character data sync, grouped by user ID.
	 */
	async getUsersNeedingCharacterDataSync(): Promise<{
		userBatches: Array<{ userId: string; characterIds: string[] }>
		unownedCharacterIds: string[]
	}> {
		return this.getService().getUsersNeedingCharacterDataSync()
	}

	/**
	 * Get detailed user information
	 */
	async getUserDetails(userId: string): Promise<UserDetails | null> {
		return this.getService().getUserDetails(userId)
	}

	/**
	 * Reconcile token validity for a user's characters and return per-character transitions.
	 */
	async syncUserCharacterTokenValidityBatch(input: {
		userId: string
		characterIds: string[]
		forceValidate?: boolean
	}): Promise<
		Array<{
			characterId: string
			previousHasValidToken: boolean | null
			nextHasValidToken: boolean | null
			validationStatus: string | null
			validationError: string | null
			refreshAttempted: boolean
			refreshSucceeded: boolean
		}>
	> {
		return this.getService().syncUserCharacterTokenValidityBatch(input)
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
	 * Back-compat RPC alias used by service-bound workers (e.g. eve-corporation-data).
	 * Returns the compact ownership shape expected by @repo/core Core interface.
	 */
	async getCharacterOwner(
		characterId: string
	): Promise<{ userId: string; isPrimary: boolean } | null> {
		const ownership = await this.getService().getCharacterOwnership(characterId)
		if (!ownership) return null
		return {
			userId: ownership.userId,
			isPrimary: ownership.isPrimary,
		}
	}

	/**
	 * Find blacklisted users that share known IP hashes with the owner of a character.
	 * Returns hashed-only data for cross-account risk checks.
	 */
	async getBlacklistedIpAssociationsForCharacter(characterId: string): Promise<{
		subjectUserId: string | null
		matches: Array<{
			userId: string
			mainCharacterId: string
			mainCharacterName: string | null
			matchingIpHashes: string[]
		}>
	}> {
		const ownership = await this.getService().getCharacterOwnership(characterId)
		if (!ownership) return { subjectUserId: null, matches: [] }

		const db = createDb(this.env.DATABASE_URL)
		const hrStub = getStub<Hr>(this.env.HR, 'default')

		const subjectHashesRows = await db
			.selectDistinct({ ipAddressHash: userIpAddresses.ipAddressHash })
			.from(userIpAddresses)
			.where(eq(userIpAddresses.userId, ownership.userId))
		const subjectHashes = subjectHashesRows.map((row) => row.ipAddressHash)
		if (subjectHashes.length === 0) return { subjectUserId: ownership.userId, matches: [] }

		const linkedRows = await db
			.select({
				userId: userIpAddresses.userId,
				ipAddressHash: userIpAddresses.ipAddressHash,
			})
			.from(userIpAddresses)
			.where(
				and(
					inArray(userIpAddresses.ipAddressHash, subjectHashes),
					ne(userIpAddresses.userId, ownership.userId)
				)
			)

		const hashByUserId = new Map<string, Set<string>>()
		for (const row of linkedRows) {
			if (row.userId === ownership.userId) continue
			const set = hashByUserId.get(row.userId) ?? new Set<string>()
			set.add(row.ipAddressHash)
			hashByUserId.set(row.userId, set)
		}

		const linkedUserIds = [...hashByUserId.keys()]
		if (linkedUserIds.length === 0) return { subjectUserId: ownership.userId, matches: [] }

		const blacklistChecks = await Promise.all(
			linkedUserIds.map(async (userId) => ({
				userId,
				isBlacklisted: await hrStub.isUserBlacklisted(userId),
			}))
		)
		const blacklistedUserIds = blacklistChecks
			.filter((result) => result.isBlacklisted)
			.map((result) => result.userId)
		if (blacklistedUserIds.length === 0) return { subjectUserId: ownership.userId, matches: [] }

		const linkedUsers = await db
			.select({
				userId: users.id,
				mainCharacterId: users.mainCharacterId,
			})
			.from(users)
			.where(inArray(users.id, blacklistedUserIds))

		const mainCharacterIds = linkedUsers.map((row) => row.mainCharacterId)
		const mainChars = mainCharacterIds.length
			? await db
					.select({
						characterId: userCharacters.characterId,
						characterName: userCharacters.characterName,
					})
					.from(userCharacters)
					.where(inArray(userCharacters.characterId, mainCharacterIds))
			: []
		const charNameById = new Map(mainChars.map((row) => [row.characterId, row.characterName]))

		return {
			subjectUserId: ownership.userId,
			matches: linkedUsers.map((row) => ({
				userId: row.userId,
				mainCharacterId: row.mainCharacterId,
				mainCharacterName: charNameById.get(row.mainCharacterId) ?? null,
				matchingIpHashes: [...(hashByUserId.get(row.userId) ?? new Set<string>())],
			})),
		}
	}

	/**
	 * Return legacy migration-style association data for a character owner (read-only consumer).
	 * This forces a recheck so Fulcrum sees fresh associations and blacklist signal state.
	 */
	async getLegacyAssociationsForCharacter(characterId: string): Promise<{
		modernUserId: string | null
		items: Array<{
			id: string
			legacyAuthUserId: string
			status: string
			modernUserMainCharacterName: string | null
			candidateSnapshot: Record<string, unknown>
			conflicts: Record<string, unknown>
			candidates: {
				characters: Array<{
					characterId: string
					characterName: string
					source: 'legacy_primary' | 'esi_owner' | 'xml_account'
					corporationId: string | null
					corporationName: string | null
					allianceId: string | null
					allianceName: string | null
					isDeleted: boolean
					alreadyLinkedToModernUser: boolean
					linkedToOtherUserId: string | null
				}>
				notes: Array<{
					legacyNoteId: string
					note: string
					legacyCreatedByUserId: string | null
					legacyCreatedByCharacterName: string | null
					legacyDateCreated: Date | null
					alreadyImported: boolean
				}>
				ipAddressCount: number
			}
		}>
	}> {
		const ownership = await this.getService().getCharacterOwnership(characterId)
		if (!ownership) return { modernUserId: null, items: [] }

		const legacyStub = getStub<Legacy>(this.env.LEGACY, 'default')
		await legacyStub.recheckUser(ownership.userId, 'system:fulcrum-report', { force: true })
		const listing = await legacyStub.listMigrations({
			page: 1,
			pageSize: 100,
			modernUserId: ownership.userId,
		})
		if (listing.items.length === 0) {
			return { modernUserId: ownership.userId, items: [] }
		}

		const details = await Promise.all(listing.items.map((item) => legacyStub.getMigration(item.id)))
		return {
			modernUserId: ownership.userId,
			items: details
				.filter((detail): detail is NonNullable<typeof detail> => detail !== null)
				.map((detail) => ({
					id: detail.item.id,
					legacyAuthUserId: detail.item.legacyAuthUserId,
					status: detail.item.status,
					modernUserMainCharacterName: detail.item.modernUserMainCharacterName ?? null,
					candidateSnapshot: detail.item.candidateSnapshot ?? {},
					conflicts: detail.item.conflicts ?? {},
					candidates: detail.candidates,
				})),
		}
	}

	/**
	 * Get corporations that should be included in background refresh
	 */
	async getCorporationsForBackgroundRefresh(): Promise<
		Array<{
			corporationId: string
			name: string
			lastSync: string | null
			includeInStructureAssetSync: boolean
			isMemberCorporation: boolean
			isAltCorp: boolean
			isSpecialPurpose: boolean
		}>
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
	 * Update corporation auth-health snapshot (used by background corporation workflows).
	 */
	async updateCorporationAuthHealth(
		corporationId: string,
		input: {
			healthyDirectorCount: number
			isVerified: boolean
			lastVerified?: string | null
		}
	): Promise<void> {
		return this.getService().updateCorporationAuthHealth(corporationId, input)
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
				operation?: 'invite' | 'update' | 'revoke-ban'
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
	 * Check whether a Discord guild is active in the registry.
	 */
	async isActiveDiscordGuild(guildId: string): Promise<boolean> {
		return this.getService().isActiveDiscordGuild(guildId)
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
	 * Get user's main character id/name by user ID.
	 */
	async getUserMainCharacter(
		userId: string
	): Promise<{ characterId: string; characterName: string } | null> {
		return this.getService().getUserMainCharacter(userId)
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
	 * Trigger user refresh workflow from internal callers
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
	 * Execute a Discord slash command using core identity + permission checks.
	 */
	async executeDiscordSlashCommand(input: ExecuteDiscordSlashCommandInput): Promise<{
		ok: boolean
		response: {
			type: number
			data?: {
				content: string
				flags?: number
			}
		}
		coreUserId: string | null
		authorized: boolean
		commandId?: string
		reason: string
	}> {
		const db = createDb(this.env.DATABASE_URL)
		const result = await executeDiscordSlashCommand(db, this.env, input)
		return {
			ok: result.reason === 'ok',
			response: result.response,
			coreUserId: result.coreUserId,
			authorized: result.authorized,
			commandId: result.commandId,
			reason: result.reason,
		}
	}

	/**
	 * Handle a Discord modal submit (P2: a prediction-market bet). Resolves the core user,
	 * runs placeBet, refreshes the public forum post, and returns an ephemeral confirmation.
	 */
	async executeDiscordModalSubmit(input: ExecuteModalSubmitInput): Promise<{
		ok: boolean
		response: { type: number; data?: { content: string; flags?: number; embeds?: unknown[] } }
		coreUserId: string | null
		reason: string
	}> {
		const db = createDb(this.env.DATABASE_URL)
		const result = await executeDiscordModalSubmit(db, this.env, input)
		const ok = result.reason === 'ok'
		// A non-ok result is a graceful error ephemeral (delivered to the user as a friendly/`try
		// again` message) — the interactions worker treats it as a successful delivery, so without
		// this line a failed bet would leave no trace on the core RPC boundary. Correlate on
		// interactionId with the '[DiscordComponents] …' service logs.
		if (!ok) {
			logger.warn('[CoreWorker] Discord modal submit returned a non-ok result', {
				interactionId: input.interactionId ?? null,
				customId: input.customId,
				coreUserId: result.coreUserId,
				reason: result.reason,
			})
		}
		// Deferred work (the settlement DM fan-out) runs AFTER we return the confirmation, so a
		// large market's rate-limited DMs never delay/time-out the resolver's ephemeral reply.
		if (result.background) {
			waitUntilWithTelemetry(this.ctx, 'pm-settlement-dms', result.background)
		}
		return {
			ok,
			response: result.response,
			coreUserId: result.coreUserId,
			reason: result.reason,
		}
	}

	/**
	 * Handle a Discord component (button) interaction (P3: resolver Close/Approve). Resolves
	 * the core user, gates on urn:markets:resolver, runs the PM write, refreshes the post.
	 */
	async executeDiscordComponent(input: ExecuteComponentInput): Promise<{
		ok: boolean
		response: { type: number; data?: { content: string; flags?: number; embeds?: unknown[] } }
		coreUserId: string | null
		reason: string
	}> {
		const db = createDb(this.env.DATABASE_URL)
		const result = await executeDiscordComponent(db, this.env, input)
		// Deferred settlement DM fan-out runs off the confirmation path (see executeDiscordModalSubmit).
		if (result.background) {
			waitUntilWithTelemetry(this.ctx, 'pm-settlement-dms', result.background)
		}
		return {
			ok: result.reason === 'ok',
			response: result.response,
			coreUserId: result.coreUserId,
			reason: result.reason,
		}
	}

	/**
	 * Return the Discord interaction deferral routing map, telling the interactions worker
	 * which commands/subcommands to defer (and whether ephemerally). Pure/in-memory —
	 * safe to call on the hot path and cache in the caller.
	 */
	async getDiscordInteractionRouting(): Promise<DiscordInteractionRouting> {
		return buildDiscordInteractionRouting()
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
		const result = await coreStub.addPendingDiscordRefreshes(uniqueUserIds, {
			source: 'corp-membership-changed',
		})

		return { usersQueued: uniqueUserIds.length, pendingCount: result.pendingCount }
	}

	private async resolveUserIdsForCharacterIds(characterIds: string[]): Promise<string[]> {
		if (characterIds.length === 0) {
			return []
		}

		const db = createDb(this.env.DATABASE_URL)
		const mappings = await db
			.select({ userId: userCharacters.userId })
			.from(userCharacters)
			.where(inArray(userCharacters.characterId, characterIds))

		return [...new Set(mappings.map((m) => m.userId))]
	}

	/**
	 * Handle an observed character affiliation change signal from external workers.
	 *
	 * This triggers the same downstream consistency path used for normal corp-change
	 * detection: user refresh workflow (affiliation persistence + role attachments)
	 * and pending Discord refresh queue updates.
	 */
	async handleCharacterAffiliationChange(
		characterId: string,
		options?: {
			source?: string
			bypassThrottle?: boolean
		}
	): Promise<{
		usersMatched: number
		workflowsTriggered: number
		discordUsersQueued: number
	}> {
		return this.handleCharacterAffiliationChanges([characterId], options)
	}

	/**
	 * Batch variant of affiliation change handling.
	 *
	 * Unified path used by director-affiliation mismatch signals and corporation
	 * membership diff signals so all sources converge on the same outcomes.
	 */
	async handleCharacterAffiliationChanges(
		characterIds: string[],
		options?: {
			source?: string
			bypassThrottle?: boolean
		}
	): Promise<{
		usersMatched: number
		workflowsTriggered: number
		discordUsersQueued: number
	}> {
		const normalizedCharacterIds = [...new Set(characterIds.map((id) => String(id)))]
		const uniqueUserIds = await this.resolveUserIdsForCharacterIds(normalizedCharacterIds)
		let workflowsTriggered = 0
		const db = createDb(this.env.DATABASE_URL)

		for (const userId of uniqueUserIds) {
			const result = await triggerUserRefreshWorkflow({
				db,
				env: this.env,
				userId,
				source: options?.source ?? 'character-affiliation-changed',
				bypassThrottle: options?.bypassThrottle ?? true,
				refreshMode: 'event',
			})
			if (result.triggered) {
				workflowsTriggered++
			}
		}

		const discordQueueResult =
			await this.addPendingDiscordRefreshesForCharacters(normalizedCharacterIds)

		return {
			usersMatched: uniqueUserIds.length,
			workflowsTriggered,
			discordUsersQueued: discordQueueResult.usersQueued,
		}
	}
}

// Export Durable Object class
// Note: Automatic Sentry instrumentation for DOs is not supported in Cloudflare Workers
// Use manual captureException() in DO methods for error tracking
export { CoreDO as Core }

// Export Workflow class
export { UserRefreshWorkflow } from './workflows/user-refresh.workflow'
export { UserDiscordRefreshWorkflow } from './workflows/user-discord-refresh.workflow'
export { DiscordMemberAuditWorkflow } from './workflows/discord-member-audit.workflow'
export { UserMumbleRefreshWorkflow } from './workflows/user-mumble-refresh.workflow'
export { CsvExportWorkflow } from './workflows/csv-export.workflow'
export { ServiceAccessAuditWorkflow } from './workflows/service-access-audit.workflow'
