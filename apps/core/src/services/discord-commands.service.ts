import { eq, inArray } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { discordCommandPermissions, discordCommands, users } from '../db/schema'
import { getCachedUserPermissions } from '../lib/groups-cache'
import {
	PROGRAMMATIC_COMMAND_DEFINITIONS,
	programmaticCommandDefinitionByName,
} from './discord-programmatic-commands'
import type { DeferralMode } from './discord-programmatic-commands'
import {
	clearRegisteredDiscordCommandsBySource,
	getRegisteredDiscordCommand,
	registerDiscordCommand,
} from './discord-command-registry.service'

import type { Discord, DiscordEmbed, DiscordSlashCommandDefinition } from '@repo/discord'
import type { Env } from '../context'
import type { createDb } from '../db'
import type { DiscordCommandOptionAlias } from './discord-command-registry.service'

const DISCORD_EPHEMERAL_FLAG = 1 << 6
const STATIC_RESPONSE_DISCORD_COMMAND_SOURCE = 'database-static-response'
const PROGRAMMATIC_DISCORD_COMMAND_SOURCE = 'programmatic'
const STATIC_REGISTRY_REFRESH_INTERVAL_MS = 60_000

interface FlattenedOption {
	name: string
	path: string
	value: string
}

interface StaticRegistryState {
	initialized: boolean
	lastLoadedAtMs: number
	loadingPromise: Promise<void> | null
}

const staticRegistryState: StaticRegistryState = {
	initialized: false,
	lastLoadedAtMs: 0,
	loadingPromise: null,
}

export interface DiscordInteractionResponse {
	type: number
	data?: {
		content: string
		flags?: number
		embeds?: DiscordEmbed[]
	}
}

export interface DiscordInteractionOption {
	name: string
	value?: unknown
	type?: number
	options?: DiscordInteractionOption[]
}

export interface ExecuteDiscordSlashCommandInput {
	commandName: string
	discordUserId: string
	guildId?: string | null
	channelId?: string | null
	options?: DiscordInteractionOption[]
	/** Discord interaction id; passed through to handlers as an idempotency key. */
	interactionId?: string | null
}

/**
 * Deferral routing map consumed by the interactions worker to decide, per command
 * (and subcommand), whether to ACK synchronously or defer (and how).
 */
export interface DiscordInteractionRouting {
	commands: Record<string, { default: DeferralMode; subcommands: Record<string, DeferralMode> }>
}

export interface ExecuteDiscordSlashCommandResult {
	response: DiscordInteractionResponse
	coreUserId: string | null
	authorized: boolean
	commandId?: string
	reason:
		| 'ok'
		| 'not-linked'
		| 'not-found'
		| 'guild-not-allowed'
		| 'missing-permission'
		| 'invalid-command'
		| 'execution-failed'
}

export type CommandEnv = Pick<
	Env,
	'GROUPS' | 'DISCORD' | 'PREDICTION_MARKETS' | 'BROADCASTS' | 'FLEETS' | 'SRP' | 'DOCTRINES'
>

function normalizeCommandName(name: string): string {
	return name.trim().toLowerCase()
}

function response(content: string): DiscordInteractionResponse {
	return {
		type: 4,
		data: { content },
	}
}

function ephemeralResponse(content: string): DiscordInteractionResponse {
	return {
		type: 4,
		data: { content, flags: DISCORD_EPHEMERAL_FLAG },
	}
}

function flattenInteractionOptions(
	options: DiscordInteractionOption[] | undefined,
	pathPrefix = ''
): FlattenedOption[] {
	if (!options || options.length === 0) {
		return []
	}

	const flattened: FlattenedOption[] = []
	for (const option of options) {
		const normalizedName = option.name.trim().toLowerCase()
		if (!normalizedName) {
			continue
		}

		const optionPath = `${pathPrefix}${normalizedName}`
		if (option.options && option.options.length > 0) {
			flattened.push(...flattenInteractionOptions(option.options, `${optionPath}.`))
		}

		if (option.value !== undefined) {
			flattened.push({
				name: normalizedName,
				path: optionPath,
				value: String(option.value),
			})
		}
	}

	return flattened
}

function buildTemplateContext(
	input: ExecuteDiscordSlashCommandInput,
	optionAliases: DiscordCommandOptionAlias[] = []
): Record<string, string> {
	const context: Record<string, string> = {
		commandName: input.commandName,
		slashTrigger: `/${input.commandName}`,
		discordUserId: input.discordUserId,
		guildId: input.guildId ?? '',
		channelId: input.channelId ?? '',
	}

	const optionValuesByPath = new Map<string, string>()
	const flattenedOptions = flattenInteractionOptions(input.options)
	for (const option of flattenedOptions) {
		optionValuesByPath.set(option.path, option.value)
		context[option.path] = option.value
		if (!Object.prototype.hasOwnProperty.call(context, option.name)) {
			context[option.name] = option.value
		}
	}

	for (const alias of optionAliases) {
		if (!alias.path || !alias.alias) continue
		const value = optionValuesByPath.get(alias.path.trim().toLowerCase())
		if (value !== undefined) {
			context[alias.alias] = value
		}
	}

	return context
}

function renderTemplate(template: string, context: Record<string, string>): string {
	return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) =>
		Object.prototype.hasOwnProperty.call(context, key) ? context[key] : ''
	)
}

async function getEffectivePermissionIdSet(env: CommandEnv, userId: string): Promise<Set<string>> {
	const permissions = await getCachedUserPermissions(env, userId)
	return new Set(
		permissions
			.map((permission) => permission.permissionId)
			.filter((permissionId): permissionId is string => typeof permissionId === 'string')
	)
}

async function ensureProgrammaticCommandRows(db: ReturnType<typeof createDb>): Promise<void> {
	const names = PROGRAMMATIC_COMMAND_DEFINITIONS.map((definition) => definition.name)
	if (names.length === 0) {
		return
	}

	const existingCommands = await db.query.discordCommands.findMany({
		where: inArray(discordCommands.name, names),
		columns: {
			name: true,
			commandType: true,
		},
	})
	const existingByName = new Map(existingCommands.map((command) => [command.name, command]))

	const missingProgrammaticRows = PROGRAMMATIC_COMMAND_DEFINITIONS.filter(
		(definition) => !existingByName.has(definition.name)
	).map((definition) => ({
		name: definition.name,
		description: definition.description,
		commandType: 'programmatic' as const,
		responseTemplate: null,
		isActive: true,
	}))

	for (const definition of PROGRAMMATIC_COMMAND_DEFINITIONS) {
		const existing = existingByName.get(definition.name)
		if (existing && existing.commandType !== 'programmatic') {
			logger.warn('[DiscordCommands] Programmatic command name conflicts with non-programmatic row', {
				commandName: definition.name,
				existingType: existing.commandType,
			})
		}
	}

	if (missingProgrammaticRows.length > 0) {
		await db.insert(discordCommands).values(missingProgrammaticRows)
	}
}

async function loadConfiguredCommandsIntoRegistry(db: ReturnType<typeof createDb>): Promise<void> {
	await ensureProgrammaticCommandRows(db)

	const activeCommands = await db.query.discordCommands.findMany({
		where: eq(discordCommands.isActive, true),
		with: {
			requiredPermissions: true,
			serverAttachments: {
				with: {
					discordServer: {
						columns: {
							guildId: true,
							isActive: true,
						},
					},
				},
			},
		},
	})

	clearRegisteredDiscordCommandsBySource(STATIC_RESPONSE_DISCORD_COMMAND_SOURCE)
	clearRegisteredDiscordCommandsBySource(PROGRAMMATIC_DISCORD_COMMAND_SOURCE)

	for (const command of activeCommands) {
		const access = {
			guildIds: command.serverAttachments
				.filter((attachment) => attachment.discordServer.isActive)
				.map((attachment) => attachment.discordServer.guildId),
			requiredPermissionIds: command.requiredPermissions.map((perm) => perm.permissionId),
		}

		if (command.commandType === 'programmatic') {
			const definition = programmaticCommandDefinitionByName.get(command.name)
			if (!definition) {
				logger.warn('[DiscordCommands] No programmatic handler registered for active command', {
					commandId: command.id,
					commandName: command.name,
				})
				continue
			}

			registerDiscordCommand({
				name: command.name,
				description: command.description,
				slashTrigger: `/${command.name}`,
				source: PROGRAMMATIC_DISCORD_COMMAND_SOURCE,
				commandId: command.id,
				access,
				optionAliases: definition.optionAliases ?? [],
				metadata: {
					categoryId: command.categoryId,
					commandType: command.commandType,
				},
				handler: (context) =>
					definition.handler({
						optionValues: context.optionValues,
						coreUserId: context.coreUserId,
						isAdmin: context.isAdmin,
						env: context.env,
						input: context.input,
						interactionId: context.interactionId,
					}),
			})
			continue
		}

		const responseTemplate = command.responseTemplate?.trim()
		if (!responseTemplate) {
			logger.warn('[DiscordCommands] Static command missing response template; skipping', {
				commandId: command.id,
				commandName: command.name,
			})
			continue
		}

		try {
			registerDiscordCommand({
				name: command.name,
				description: command.description,
				slashTrigger: `/${command.name}`,
				source: STATIC_RESPONSE_DISCORD_COMMAND_SOURCE,
				commandId: command.id,
				access,
				metadata: {
					categoryId: command.categoryId,
					commandType: command.commandType,
					responseTemplate,
				},
				handler: ({ command: registeredCommand, input }) => {
					const message = renderTemplate(
						responseTemplate,
						buildTemplateContext(input, registeredCommand.optionAliases ?? [])
					).trim()
					return response(message || 'Command executed successfully.')
				},
			})
		} catch (error) {
			logger.warn('[DiscordCommands] Skipping static command registry entry due to conflict', {
				commandId: command.id,
				commandName: command.name,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	staticRegistryState.initialized = true
	staticRegistryState.lastLoadedAtMs = Date.now()
}

export async function ensureDiscordCommandRegistryLoaded(
	db: ReturnType<typeof createDb>,
	options?: { force?: boolean }
): Promise<void> {
	const force = options?.force ?? false
	const shouldRefreshByInterval =
		Date.now() - staticRegistryState.lastLoadedAtMs > STATIC_REGISTRY_REFRESH_INTERVAL_MS

	if (
		!force &&
		staticRegistryState.initialized &&
		!shouldRefreshByInterval &&
		!staticRegistryState.loadingPromise
	) {
		return
	}

	if (staticRegistryState.loadingPromise) {
		await staticRegistryState.loadingPromise
		if (!force) {
			return
		}
	}

	staticRegistryState.loadingPromise = loadConfiguredCommandsIntoRegistry(db)
	try {
		await staticRegistryState.loadingPromise
	} finally {
		staticRegistryState.loadingPromise = null
	}
}

export async function refreshDiscordCommandRegistry(
	db: ReturnType<typeof createDb>
): Promise<void> {
	await ensureDiscordCommandRegistryLoaded(db, { force: true })
}

export function resetDiscordCommandRegistryCacheForTests(): void {
	staticRegistryState.initialized = false
	staticRegistryState.lastLoadedAtMs = 0
	staticRegistryState.loadingPromise = null
	clearRegisteredDiscordCommandsBySource(STATIC_RESPONSE_DISCORD_COMMAND_SOURCE)
	clearRegisteredDiscordCommandsBySource(PROGRAMMATIC_DISCORD_COMMAND_SOURCE)
}

export async function executeDiscordSlashCommand(
	db: ReturnType<typeof createDb>,
	env: CommandEnv,
	input: ExecuteDiscordSlashCommandInput
): Promise<ExecuteDiscordSlashCommandResult> {
	const commandName = normalizeCommandName(input.commandName)
	if (!/^[a-z0-9_-]{1,32}$/.test(commandName)) {
		return {
			response: ephemeralResponse('Invalid slash command name.'),
			coreUserId: null,
			authorized: false,
			reason: 'invalid-command',
		}
	}

	const user = await db.query.users.findFirst({
		where: eq(users.discordUserId, input.discordUserId),
		columns: {
			id: true,
			is_admin: true,
		},
	})

	if (!user) {
		return {
			response: ephemeralResponse(
				'Your Discord account is not linked to a core user. Link your account in the app first.'
			),
			coreUserId: null,
			authorized: false,
			reason: 'not-linked',
		}
	}

	try {
		await ensureDiscordCommandRegistryLoaded(db)
	} catch (error) {
		logger.error('[DiscordCommands] Failed to initialize command registry', {
			commandName,
			error: error instanceof Error ? error.message : String(error),
		})
		return {
			response: ephemeralResponse('Command execution failed. Please try again later.'),
			coreUserId: user.id,
			authorized: false,
			reason: 'execution-failed',
		}
	}

	let registeredCommand = getRegisteredDiscordCommand(commandName)
	if (!registeredCommand) {
		try {
			await refreshDiscordCommandRegistry(db)
		} catch (error) {
			logger.error('[DiscordCommands] Failed to refresh command registry after miss', {
				commandName,
				error: error instanceof Error ? error.message : String(error),
			})
			return {
				response: ephemeralResponse('Command execution failed. Please try again later.'),
				coreUserId: user.id,
				authorized: false,
				reason: 'execution-failed',
			}
		}
		registeredCommand = getRegisteredDiscordCommand(commandName)
	}

	if (!registeredCommand) {
		return {
			response: ephemeralResponse('This command is not available.'),
			coreUserId: user.id,
			authorized: false,
			reason: 'not-found',
		}
	}

	if (!input.guildId || !registeredCommand.access.guildIds.includes(input.guildId)) {
		return {
			response: ephemeralResponse('This command is not enabled for this server.'),
			coreUserId: user.id,
			authorized: false,
			commandId: registeredCommand.commandId,
			reason: 'guild-not-allowed',
		}
	}

	if (!user.is_admin && registeredCommand.access.requiredPermissionIds.length > 0) {
		const permissionIds = await getEffectivePermissionIdSet(env, user.id)
		const hasAccess = registeredCommand.access.requiredPermissionIds.some((requiredPermissionId) =>
			permissionIds.has(requiredPermissionId)
		)
		if (!hasAccess) {
			return {
				response: ephemeralResponse('You do not have permission to use this command.'),
				coreUserId: user.id,
				authorized: false,
				commandId: registeredCommand.commandId,
				reason: 'missing-permission',
			}
		}
	}

	try {
		const normalizedInput: ExecuteDiscordSlashCommandInput = {
			...input,
			commandName,
		}
		const optionValues = buildTemplateContext(normalizedInput, registeredCommand.optionAliases ?? [])
		const interactionResponse = await registeredCommand.handler({
			input: normalizedInput,
			coreUserId: user.id,
			isAdmin: user.is_admin,
			command: registeredCommand,
			optionValues,
			env,
			interactionId: normalizedInput.interactionId ?? null,
		})

		return {
			response: interactionResponse,
			coreUserId: user.id,
			authorized: true,
			commandId: registeredCommand.commandId,
			reason: 'ok',
		}
	} catch (error) {
		logger.error('[DiscordCommands] Registered command handler threw', {
			commandName,
			commandId: registeredCommand.commandId,
			coreUserId: user.id,
			error: error instanceof Error ? error.message : String(error),
		})
		return {
			response: ephemeralResponse('Command execution failed. Please try again later.'),
			coreUserId: user.id,
			authorized: false,
			commandId: registeredCommand.commandId,
			reason: 'execution-failed',
		}
	}
}

/**
 * Build the deferral routing map the interactions worker uses to decide, per command
 * (and subcommand), whether to ACK synchronously or defer (and whether ephemerally).
 * Computed purely from the programmatic command definitions (no DB); static-response
 * commands are absent from the map and therefore default to 'sync'.
 */
export function buildDiscordInteractionRouting(): DiscordInteractionRouting {
	const commands: DiscordInteractionRouting['commands'] = {}

	for (const definition of PROGRAMMATIC_COMMAND_DEFINITIONS) {
		const name = normalizeCommandName(definition.name)
		const deferral = definition.deferral
		let defaultMode: DeferralMode = 'sync'
		const subcommands: Record<string, DeferralMode> = {}

		if (typeof deferral === 'string') {
			defaultMode = deferral
		} else if (deferral) {
			defaultMode = deferral.default ?? 'sync'
			for (const [key, mode] of Object.entries(deferral.subcommands ?? {})) {
				if (mode) {
					subcommands[key.trim().toLowerCase()] = mode
				}
			}
		}

		commands[name] = { default: defaultMode, subcommands }
	}

	return { commands }
}

export function buildDiscordSlashCommandDefinition(command: {
	name: string
	description: string
	commandType: 'static_response' | 'programmatic'
}): DiscordSlashCommandDefinition {
	const name = normalizeCommandName(command.name)

	if (command.commandType === 'programmatic') {
		const definition = programmaticCommandDefinitionByName.get(name)
		if (definition) {
			return {
				name,
				description: command.description.trim(),
				...(definition.options && definition.options.length > 0
					? { options: definition.options }
					: {}),
			}
		}

		logger.warn('[DiscordCommands] Missing programmatic definition while building slash registration', {
			commandName: name,
		})
	}

	return {
		name,
		description: command.description.trim(),
	}
}

export async function upsertGuildSlashCommand(
	env: Pick<Env, 'DISCORD'>,
	guildId: string,
	command: DiscordSlashCommandDefinition
): Promise<{ id: string; name: string; description: string }> {
	const discordStub = getStub<Discord>(env.DISCORD, 'default')
	return discordStub.upsertGuildSlashCommand(guildId, command)
}

export async function deleteGuildSlashCommand(
	env: Pick<Env, 'DISCORD'>,
	guildId: string,
	opts: { commandId?: string; commandName?: string }
): Promise<{ success: boolean; deletedCommandId?: string; error?: string }> {
	const discordStub = getStub<Discord>(env.DISCORD, 'default')
	return discordStub.deleteGuildSlashCommand(guildId, opts)
}

export async function replaceCommandPermissions(
	db: ReturnType<typeof createDb>,
	commandId: string,
	permissionIds: string[]
): Promise<void> {
	await db.delete(discordCommandPermissions).where(eq(discordCommandPermissions.commandId, commandId))
	if (permissionIds.length === 0) {
		return
	}
	await db.insert(discordCommandPermissions).values(
		permissionIds.map((permissionId) => ({
			commandId,
			permissionId,
		}))
	)
}
