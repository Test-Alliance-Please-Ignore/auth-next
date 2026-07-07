import type {
	CommandEnv,
	DiscordInteractionResponse,
	ExecuteDiscordSlashCommandInput,
} from './discord-commands.service'

export type DiscordCommandSource = 'database-static-response' | 'programmatic'

export interface DiscordCommandOptionAlias {
	path: string
	alias: string
}

export interface DiscordCommandAccessPolicy {
	guildIds: string[]
	requiredPermissionIds: string[]
}

export interface DiscordCommandExecutionContext {
	input: ExecuteDiscordSlashCommandInput
	coreUserId: string
	isAdmin: boolean
	command: RegisteredDiscordCommand
	optionValues: Record<string, string>
	/** Bindings available to command handlers (e.g. for cross-worker RPC). */
	env: CommandEnv
	/** Discord interaction id; use as an idempotency key for write commands. */
	interactionId: string | null
}

export type DiscordCommandHandler = (
	context: DiscordCommandExecutionContext
) => Promise<DiscordInteractionResponse> | DiscordInteractionResponse

export interface RegisteredDiscordCommand {
	name: string
	description: string
	slashTrigger: string
	source: DiscordCommandSource
	commandId?: string
	access: DiscordCommandAccessPolicy
	optionAliases?: DiscordCommandOptionAlias[]
	metadata?: Record<string, unknown>
	handler: DiscordCommandHandler
}

const commandRegistry = new Map<string, RegisteredDiscordCommand>()

function normalizeCommandName(name: string): string {
	return name.trim().toLowerCase()
}

export function registerDiscordCommand(command: RegisteredDiscordCommand): void {
	const normalizedName = normalizeCommandName(command.name)
	const existing = commandRegistry.get(normalizedName)
	if (existing && existing.source !== command.source) {
		throw new Error(
			`Command "${normalizedName}" already registered by source "${existing.source}" and cannot be overridden by "${command.source}"`
		)
	}

	commandRegistry.set(normalizedName, {
		...command,
		name: normalizedName,
		slashTrigger: command.slashTrigger.trim() || `/${normalizedName}`,
		access: {
			guildIds: [...new Set(command.access.guildIds.map((guildId) => guildId.trim()))].filter(Boolean),
			requiredPermissionIds: [
				...new Set(command.access.requiredPermissionIds.map((permissionId) => permissionId.trim())),
			].filter(Boolean),
		},
		optionAliases:
			command.optionAliases?.map((alias) => ({
				path: alias.path.trim().toLowerCase(),
				alias: alias.alias.trim(),
			})) ?? [],
	})
}

export function registerDiscordCommands(commands: RegisteredDiscordCommand[]): void {
	for (const command of commands) {
		registerDiscordCommand(command)
	}
}

export function getRegisteredDiscordCommand(name: string): RegisteredDiscordCommand | null {
	return commandRegistry.get(normalizeCommandName(name)) ?? null
}

export function clearRegisteredDiscordCommandsBySource(source: DiscordCommandSource): void {
	for (const [name, command] of commandRegistry.entries()) {
		if (command.source === source) {
			commandRegistry.delete(name)
		}
	}
}

export function resetDiscordCommandRegistryForTests(): void {
	commandRegistry.clear()
}
