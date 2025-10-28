import { DurableObject } from 'cloudflare:workers'
import type {
	FeatureFlag,
	Features,
	ListFlagsOptions,
	RegisterFlagOptions,
	SetFlagOptions,
} from '@repo/features'
import type { Env } from './context'
import { createDb } from './db'
import { FeatureFlagService } from './services/feature-flag.service'

/**
 * Features Durable Object
 *
 * This Durable Object provides RPC methods for managing feature flags
 * using PostgreSQL storage via Drizzle ORM.
 */
export class FeaturesDO extends DurableObject implements Features {
	private service: FeatureFlagService

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env,
	) {
		super(state, env)

		// Initialize database client and service
		const db = createDb(env.DATABASE_URL)
		this.service = new FeatureFlagService(db)
	}

	/**
	 * Register a new feature flag
	 */
	async registerFlag(key: string, value: boolean, options?: RegisterFlagOptions): Promise<FeatureFlag> {
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
		options?: SetFlagOptions,
	): Promise<FeatureFlag> {
		return await this.service.setFlag(key, value, options)
	}

	/**
	 * Check a feature flag value
	 */
	async checkFlag(key: string, tags?: string[]): Promise<boolean | string | number | unknown | null> {
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
	 * Fetch handler for HTTP requests to the Durable Object
	 * (Optional - for direct HTTP access if needed)
	 */
	async fetch(request: Request): Promise<Response> {
		return new Response('Features Durable Object - Use RPC methods for feature flag management', {
			status: 200,
		})
	}
}
