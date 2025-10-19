import { DurableObject } from 'cloudflare:workers'

import {
	AuthorizationUrlResponse,
	CallbackResult,
	Discord,
	DISCORD_REQUIRED_SCOPES,
} from '@repo/discord'

import type { Env } from './context'

/**
 * Discord Durable Object
 *
 * This Durable Object uses SQLite storage and implements:
 * - RPC methods for remote calls
 * - WebSocket hibernation API
 * - Alarm handler for scheduled tasks
 * - SQLite storage via sql.exec()
 */
export class DiscordDO extends DurableObject<Env> implements Discord {
	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
	}

	async startLoginFlow(state?: string): Promise<AuthorizationUrlResponse> {
		return this.generateAuthUrl(state)
	}

	async handleCallback(code: string, state?: string): Promise<CallbackResult> {}
	async refreshToken(userId: string): Promise<boolean> {}
	async revokeToken(userId: string): Promise<boolean> {}
	async inviteUserToGuild(userId: string, guildId: string): Promise<boolean> {}
	async kickUserFromGuild(guildId: string, userId: string): Promise<boolean> {}

	/**
	 * Generate authorization URL for EVE SSO
	 */
	private generateAuthUrl(state?: string): AuthorizationUrlResponse {
		const generatedState = state ?? crypto.randomUUID()

		const params = new URLSearchParams({
			response_type: 'code',
			redirect_uri: this.env.DISCORD_CALLBACK_URL,
			client_id: this.env.DISCORD_CLIENT_ID,
			scope: DISCORD_REQUIRED_SCOPES.join(' '),
			state: generatedState,
		})

		return {
			url: `${this.env.DISCORD_AUTHORIZE_URL}?${params.toString()}`,
			state: generatedState,
		}
	}
}
