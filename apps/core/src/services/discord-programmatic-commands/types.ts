import type {
	DiscordActionRow,
	DiscordInteractionResponse,
	DiscordModalLabelComponent,
	DiscordSlashCommandDefinition,
} from '@repo/discord'
import type { Env } from '../../context'
import type { ExecuteDiscordSlashCommandInput } from '../discord-commands.service'
import type { DiscordCommandOptionAlias } from '../discord-command-registry.service'

export type ProgrammaticCommandResponse = DiscordInteractionResponse

/** A handler error that is safe and useful to show to the Discord user. */
export class ProgrammaticCommandPermissionError extends Error {
	readonly code = 'permission' as const

	constructor(message: string) {
		super(message)
		this.name = 'ProgrammaticCommandPermissionError'
	}
}

/**
 * How the interactions receiver should acknowledge a command:
 * - 'sync': reply immediately (type:4). For instant commands with no slow work.
 * - 'defer-public': ACK deferred (type:5), deliver a public followup.
 * - 'defer-ephemeral': ACK deferred (type:5, ephemeral), deliver an ephemeral followup.
 *
 * Any command that may exceed Discord's ~3s ACK deadline must be deferred.
 */
export type DeferralMode = 'sync' | 'defer-public' | 'defer-ephemeral'

/** Subset of bindings a programmatic handler may use. Extend as new command surfaces need more. */
export type ProgrammaticCommandEnv = Pick<
	Env,
	| 'DATABASE_URL'
	| 'GROUPS'
	| 'DISCORD'
	| 'TEMPORARY_ROLE_ASSIGNMENTS'
	| 'USER_DISCORD_REFRESH_WORKFLOW'
	| 'PREDICTION_MARKETS'
	| 'BROADCASTS'
	| 'FLEETS'
	| 'SRP'
	| 'DOCTRINES'
>

export interface ProgrammaticCommandContext {
	optionValues: Record<string, string>
	coreUserId: string
	isAdmin: boolean
	env: ProgrammaticCommandEnv
	input: ExecuteDiscordSlashCommandInput
	/** Discord interaction id; use as an idempotency key for write commands. */
	interactionId: string | null
}

export interface ProgrammaticCommandDefinition {
	name: string
	description: string
	/** Default admin UI category used when bootstrapping the database command row. */
	categoryName?: string
	/**
	 * Human-readable access requirements that are enforced in code and should be shown as locked
	 * entries in the admin UI.
	 */
	immutableAccessRequirements?: string[]
	options?: DiscordSlashCommandDefinition['options']
	optionAliases?: DiscordCommandOptionAlias[]
	/**
	 * Deferral behavior. A single mode applies to the whole command; the object form allows
	 * per-subcommand overrides keyed by the subcommand routing suffix (e.g. 'bet', or
	 * 'settle resolve' for a subcommand group). Omitted ⇒ 'sync'.
	 */
	deferral?: DeferralMode | { default?: DeferralMode; subcommands?: Record<string, DeferralMode> }
	handler: (
		ctx: ProgrammaticCommandContext
	) => Promise<ProgrammaticCommandResponse> | ProgrammaticCommandResponse
}

export function commandResponse(content: string): ProgrammaticCommandResponse {
	return {
		type: 4,
		data: { content },
	}
}

const DISCORD_EPHEMERAL_FLAG = 1 << 6

/**
 * An ephemeral (private) response. On the deferred path ephemerality is fixed at the type:5
 * ACK and this flag is ignored; the flag only matters as a safety net if the command ever
 * runs sync (e.g. the routing map failed to load) — use this for commands whose content is
 * private/self-only so a sync fallback can't post it publicly.
 */
export function ephemeralCommandResponse(content: string): ProgrammaticCommandResponse {
	return {
		type: 4,
		data: { content, flags: DISCORD_EPHEMERAL_FLAG },
	}
}

export function ephemeralCommandResponseWithComponents(
	content: string,
	components: DiscordActionRow[]
): ProgrammaticCommandResponse {
	return {
		type: 4,
		data: { content, flags: DISCORD_EPHEMERAL_FLAG, components },
	}
}

export function modalCommandResponse(
	title: string,
	customId: string,
	components: DiscordModalLabelComponent[]
): ProgrammaticCommandResponse {
	return {
		type: 9,
		data: { custom_id: customId, title, components },
	}
}
