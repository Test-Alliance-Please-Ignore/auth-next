import type {
	DeferralMode,
	DiscordInteractionOption,
	DiscordInteractionRouting,
} from '../context'

// Application command option types
// https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-option-type
const DISCORD_OPTION_TYPE_SUB_COMMAND = 1
const DISCORD_OPTION_TYPE_SUB_COMMAND_GROUP = 2

/**
 * Extract the subcommand routing suffix (e.g. 'bet' or 'settle resolve') from an
 * interaction's options tree, so the receiver can look up per-subcommand deferral behavior.
 * Returns null when the command has no subcommand (only value options, or none).
 */
export function resolveSubcommandKey(
	options: DiscordInteractionOption[] | undefined
): string | null {
	if (!options || options.length === 0) {
		return null
	}
	const first = options[0]
	if (first.type === DISCORD_OPTION_TYPE_SUB_COMMAND) {
		return first.name.trim().toLowerCase()
	}
	if (first.type === DISCORD_OPTION_TYPE_SUB_COMMAND_GROUP) {
		const group = first.name.trim().toLowerCase()
		const nested = first.options?.[0]?.name
		return nested ? `${group} ${nested.trim().toLowerCase()}` : group
	}
	return null
}

/**
 * Resolve how a command (and optional subcommand) should be acknowledged: subcommand
 * override → command default → 'sync' for unknown commands (preserving synchronous behavior).
 */
export function resolveDeferralMode(
	routing: DiscordInteractionRouting,
	commandName: string,
	subKey: string | null
): DeferralMode {
	const entry = routing.commands[commandName]
	if (!entry) {
		return 'sync'
	}
	if (subKey && entry.subcommands[subKey]) {
		return entry.subcommands[subKey]
	}
	return entry.default
}
