import { DurableObject } from 'cloudflare:workers'

import { createDb } from './db'
import { FeatureFlagService } from './services/feature-flag.service'
import { UserFeatureFlagService } from './services/user-feature-flag.service'

import type {
	FeatureFlag,
	Features,
	ListFlagsOptions,
	ListFlagUsersOptions,
	ListUserFlagsOptions,
	RegisterFlagOptions,
	SetFlagOptions,
	UserFeatureFlag,
} from '@repo/features'
import type { Env } from './context'

/**
 * Features Durable Object
 *
 * This Durable Object provides RPC methods for managing feature flags
 * using PostgreSQL storage via Drizzle ORM.
 */
export class FeaturesDO extends DurableObject implements Features {
	private service: FeatureFlagService
	private userService: UserFeatureFlagService

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		// Initialize database client and services
		const db = createDb(env.DATABASE_URL)
		this.service = new FeatureFlagService(db)
		this.userService = new UserFeatureFlagService(db)
	}

	/**
	 * Register a new feature flag
	 */
	async registerFlag(
		key: string,
		value: boolean,
		options?: RegisterFlagOptions
	): Promise<FeatureFlag> {
		return await this.service.registerFlag(key, value, options)
	}

	/**
	 * Delete a feature flag by key
	 */
	async deleteFlag(key: string): Promise<boolean> {
		return await this.service.deleteFlag(key)
	}

	/**
	 * Set/update a feature flag value
	 */
	async setFlag(
		key: string,
		value: boolean | string | number | unknown,
		options?: SetFlagOptions
	): Promise<FeatureFlag> {
		return await this.service.setFlag(key, value, options)
	}

	/**
	 * Check a feature flag value
	 */
	async checkFlag(
		key: string,
		tags?: string[]
	): Promise<boolean | string | number | unknown | null> {
		return await this.service.checkFlag(key, tags)
	}

	/**
	 * List feature flags with optional filtering
	 */
	async listFlags(options?: ListFlagsOptions): Promise<FeatureFlag[]> {
		return await this.service.listFlags(options)
	}

	/**
	 * Get a feature flag by key
	 */
	async getFlag(key: string): Promise<FeatureFlag | null> {
		return await this.service.getFlag(key)
	}

	/**
	 * Set (create or update) a per-user override for a feature flag
	 */
	async setUserFlag(userId: string, key: string, enabled: boolean): Promise<UserFeatureFlag> {
		return await this.userService.setUserFlag(userId, key, enabled)
	}

	/**
	 * Get a user's override for a feature flag
	 */
	async getUserFlag(userId: string, key: string): Promise<UserFeatureFlag | null> {
		return await this.userService.getUserFlag(userId, key)
	}

	/**
	 * Delete a user's override for a feature flag
	 */
	async deleteUserFlag(userId: string, key: string): Promise<boolean> {
		return await this.userService.deleteUserFlag(userId, key)
	}

	/**
	 * Resolve whether a feature is enabled for a specific user
	 */
	async checkUserFlag(userId: string, key: string): Promise<boolean> {
		return await this.userService.checkUserFlag(userId, key)
	}

	/**
	 * Resolve multiple feature flags for a user in a single call
	 */
	async checkUserFlags(userId: string, keys: string[]): Promise<Record<string, boolean>> {
		return await this.userService.checkUserFlags(userId, keys)
	}

	/**
	 * List a user's feature flag overrides
	 */
	async listUserFlags(
		userId: string,
		options?: ListUserFlagsOptions
	): Promise<UserFeatureFlag[]> {
		return await this.userService.listUserFlags(userId, options)
	}

	/**
	 * List the users who have an override for a given feature flag
	 */
	async listFlagUsers(key: string, options?: ListFlagUsersOptions): Promise<UserFeatureFlag[]> {
		return await this.userService.listFlagUsers(key, options)
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 * (Optional - for direct HTTP access if needed)
	 */
	async fetch(_request: Request): Promise<Response> {
		return new Response('Features Durable Object - Use RPC methods for feature flag management', {
			status: 200,
		})
	}
}
