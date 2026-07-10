import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	/**
	 * Verified Email Routing destination that receives mail when inbound processing fails.
	 * Optional — if unset, the last resort for an internal failure is a permanent reject.
	 */
	FALLBACK_FORWARD_ADDRESS?: string
	/**
	 * Example config: verified destination for the `team@` alias. Unset ⇒ the alias route
	 * falls through to the no-match policy (nothing is forwarded).
	 */
	FORWARD_TEAM_TO?: string

	/** Cross-worker binding to the shared Discord Durable Object (`apps/discord`). */
	DISCORD: DurableObjectNamespace
	/** Discord guild/server ID the bot posts to (required for the markeedragon→Discord route). */
	DISCORD_GUILD_ID?: string
	/** Discord channel ID that receives mail sent to `markeedragon@`. */
	MARKEE_DISCORD_CHANNEL_ID?: string

	/** Cross-worker binding to the Prediction Markets Durable Object (`apps/prediction-markets`). */
	PREDICTION_MARKETS: DurableObjectNamespace
	/**
	 * Points awarded to a random prediction-market wallet on a markeedragon@ email (paid from the
	 * house wallet). Optional — defaults to a small fixed amount when unset. Must be a positive integer.
	 */
	MARKEE_BONUS_AMOUNT?: string
}

/** Variables can be extended per-request as needed. */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
