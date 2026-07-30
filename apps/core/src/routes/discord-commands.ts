import { Hono } from 'hono'
import { z } from 'zod'

import { and, asc, desc, eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import {
	discordCommandCategories,
	discordCommands,
	discordServerCommands,
	discordServers,
} from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/session'
import {
	buildDiscordSlashCommandDefinition,
	deleteGuildSlashCommand,
	ensureDiscordCommandRegistryLoaded,
	invalidateDiscordCommandRegistryCache,
	refreshDiscordCommandRegistry,
	replaceCommandPermissions,
	upsertGuildSlashCommand,
} from '../services/discord-commands.service'
import { programmaticCommandDefinitionByName } from '../services/discord-programmatic-commands'

import type { App } from '../context'

const app = new Hono<App>()

const commandNameSchema = z
	.string()
	.trim()
	.toLowerCase()
	.regex(/^[a-z0-9_-]{1,32}$/)

const categoryCreateSchema = z.object({
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(1000).optional(),
	sortOrder: z.number().int().min(-10_000).max(10_000).optional(),
})

const categoryUpdateSchema = categoryCreateSchema.partial()

const commandCreateSchema = z.object({
	categoryId: z.string().uuid().optional().nullable(),
	name: commandNameSchema,
	description: z.string().trim().min(1).max(100),
	responseTemplate: z.string().trim().min(1).max(2000),
	isActive: z.boolean().optional(),
	requiredPermissionIds: z.array(z.string().trim().min(1)).optional(),
})

const commandUpdateSchema = z
	.object({
		categoryId: z.string().uuid().optional().nullable(),
		name: commandNameSchema.optional(),
		description: z.string().trim().min(1).max(100).optional(),
		responseTemplate: z.string().trim().min(1).max(2000).optional(),
		isActive: z.boolean().optional(),
		requiredPermissionIds: z.array(z.string().trim().min(1)).optional(),
	})
	.refine(
		(data) =>
			data.categoryId !== undefined ||
			data.name !== undefined ||
			data.description !== undefined ||
			data.responseTemplate !== undefined ||
			data.isActive !== undefined ||
			data.requiredPermissionIds !== undefined,
		{ message: 'No updates provided' }
	)

const serverAttachSchema = z.object({
	serverId: z.string().uuid(),
})

async function getCommandWithRelations(db: NonNullable<App['Variables']['db']>, commandId: string) {
	const command = await db.query.discordCommands.findFirst({
		where: eq(discordCommands.id, commandId),
		with: {
			category: true,
			requiredPermissions: true,
			serverAttachments: {
				with: {
					discordServer: true,
				},
			},
		},
	})
	return decorateCommandWithImmutableAccess(command)
}

function decorateCommandWithImmutableAccess(command: any) {
	if (!command) return command
	const immutableAccessRequirements =
		command.commandType === 'programmatic'
			? (programmaticCommandDefinitionByName.get(command.name)?.immutableAccessRequirements ?? [])
			: []
	return {
		...command,
		immutableAccessRequirements,
	}
}

async function syncSingleCommandToAttachment(
	db: NonNullable<App['Variables']['db']>,
	env: App['Bindings'],
	params: {
		commandId: string
		attachmentId: string
		guildId: string
		name: string
		description: string
		commandType: 'static_response' | 'programmatic'
		oldDiscordCommandId?: string | null
	}
): Promise<{ success: boolean; discordCommandId?: string; error?: string }> {
	try {
		const registered = await upsertGuildSlashCommand(
			env,
			params.guildId,
			buildDiscordSlashCommandDefinition({
				name: params.name,
				description: params.description,
				commandType: params.commandType,
			})
		)

		await db
			.update(discordServerCommands)
			.set({
				discordCommandId: registered.id,
				updatedAt: new Date(),
			})
			.where(eq(discordServerCommands.id, params.attachmentId))

		if (params.oldDiscordCommandId && params.oldDiscordCommandId !== registered.id) {
			await deleteGuildSlashCommand(env, params.guildId, { commandId: params.oldDiscordCommandId })
		}

		return { success: true, discordCommandId: registered.id }
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to sync command attachment',
		}
	}
}

async function refreshRegistryBestEffort(
	db: NonNullable<App['Variables']['db']>,
	env: App['Bindings']
): Promise<void> {
	try {
		invalidateDiscordCommandRegistryCache()
		await refreshDiscordCommandRegistry(db, env)
	} catch (error) {
		logger.error('[DiscordCommands] Failed to refresh runtime command registry', {
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

app.use('*', requireAuth(), requireAdmin())

app.get('/categories', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	const categories = await db.query.discordCommandCategories.findMany({
		orderBy: [asc(discordCommandCategories.sortOrder), asc(discordCommandCategories.name)],
	})
	return c.json(categories)
})

app.post('/categories', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	const parsed = categoryCreateSchema.safeParse(await c.req.json())
	if (!parsed.success) {
		return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
	}
	const [created] = await db
		.insert(discordCommandCategories)
		.values({
			name: parsed.data.name,
			description: parsed.data.description ?? null,
			sortOrder: parsed.data.sortOrder ?? 0,
		})
		.returning()

	return c.json(created, 201)
})

app.patch('/categories/:id', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	const categoryId = c.req.param('id')

	const parsed = categoryUpdateSchema.safeParse(await c.req.json())
	if (!parsed.success) {
		return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
	}

	const existing = await db.query.discordCommandCategories.findFirst({
		where: eq(discordCommandCategories.id, categoryId),
	})
	if (!existing) return c.json({ error: 'Category not found' }, 404)

	const [updated] = await db
		.update(discordCommandCategories)
		.set({
			...(parsed.data.name !== undefined && { name: parsed.data.name }),
			...(parsed.data.description !== undefined && { description: parsed.data.description }),
			...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
			updatedAt: new Date(),
		})
		.where(eq(discordCommandCategories.id, categoryId))
		.returning()

	return c.json(updated)
})

app.delete('/categories/:id', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	const categoryId = c.req.param('id')

	await db.delete(discordCommandCategories).where(eq(discordCommandCategories.id, categoryId))
	return c.json({ success: true })
})

app.get('/', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	try {
		await ensureDiscordCommandRegistryLoaded(db, c.env)
	} catch (error) {
		logger.error('[DiscordCommands] Failed to initialize command registry before list', {
			error: error instanceof Error ? error.message : String(error),
		})
	}

	const commands = await db.query.discordCommands.findMany({
		orderBy: [desc(discordCommands.updatedAt)],
		with: {
			category: true,
			requiredPermissions: true,
			serverAttachments: {
				with: {
					discordServer: true,
				},
			},
		},
	})

	return c.json(commands.map((command) => decorateCommandWithImmutableAccess(command)))
})

app.post('/', async (c) => {
	const db = c.get('db')
	const user = c.get('user')!
	if (!db) return c.json({ error: 'Database not available' }, 500)

	const parsed = commandCreateSchema.safeParse(await c.req.json())
	if (!parsed.success) {
		return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
	}
	if (programmaticCommandDefinitionByName.has(parsed.data.name)) {
		return c.json({ error: 'This command name is reserved for a programmatic command' }, 409)
	}

	const [created] = await db
		.insert(discordCommands)
		.values({
			categoryId: parsed.data.categoryId ?? null,
			name: parsed.data.name,
			description: parsed.data.description,
			commandType: 'static_response',
			responseTemplate: parsed.data.responseTemplate,
			isActive: parsed.data.isActive ?? true,
			createdBy: user.id,
		})
		.returning({ id: discordCommands.id })

	await replaceCommandPermissions(db, created.id, parsed.data.requiredPermissionIds ?? [])
	await refreshRegistryBestEffort(db, c.env)
	const command = await getCommandWithRelations(db, created.id)
	return c.json(command, 201)
})

app.patch('/:id', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	const commandId = c.req.param('id')

	const parsed = commandUpdateSchema.safeParse(await c.req.json())
	if (!parsed.success) {
		return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
	}

	const existing = await db.query.discordCommands.findFirst({
		where: eq(discordCommands.id, commandId),
		with: {
			serverAttachments: {
				with: {
					discordServer: true,
				},
			},
		},
	})
	if (!existing) return c.json({ error: 'Command not found' }, 404)

	if (existing.commandType === 'programmatic') {
		if (parsed.data.name !== undefined && parsed.data.name !== existing.name) {
			return c.json({ error: 'Programmatic command names are immutable' }, 400)
		}
		if (parsed.data.responseTemplate !== undefined) {
			return c.json({ error: 'Programmatic commands do not support response templates' }, 400)
		}
	}
	if (
		existing.commandType !== 'programmatic' &&
		parsed.data.name !== undefined &&
		programmaticCommandDefinitionByName.has(parsed.data.name)
	) {
		return c.json({ error: 'This command name is reserved for a programmatic command' }, 409)
	}

	await db
		.update(discordCommands)
		.set({
			...(parsed.data.categoryId !== undefined && { categoryId: parsed.data.categoryId }),
			...(parsed.data.name !== undefined && { name: parsed.data.name }),
			...(parsed.data.description !== undefined && { description: parsed.data.description }),
			...(existing.commandType !== 'programmatic' && parsed.data.responseTemplate !== undefined
				? {
						responseTemplate: parsed.data.responseTemplate,
					}
				: {}),
			...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
			updatedAt: new Date(),
		})
		.where(eq(discordCommands.id, commandId))

	if (parsed.data.requiredPermissionIds !== undefined) {
		await replaceCommandPermissions(db, commandId, parsed.data.requiredPermissionIds)
	}

	await refreshRegistryBestEffort(db, c.env)

	const nameChanged = parsed.data.name !== undefined && parsed.data.name !== existing.name
	const descriptionChanged =
		parsed.data.description !== undefined && parsed.data.description !== existing.description

	if (nameChanged || descriptionChanged) {
		const targetName = parsed.data.name ?? existing.name
		const targetDescription = parsed.data.description ?? existing.description

		for (const attachment of existing.serverAttachments) {
			const result = await syncSingleCommandToAttachment(db, c.env, {
				commandId,
				attachmentId: attachment.id,
				guildId: attachment.discordServer.guildId,
				name: targetName,
				description: targetDescription,
				commandType: existing.commandType,
				oldDiscordCommandId: attachment.discordCommandId,
			})
			if (!result.success) {
				logger.error('[DiscordCommands] Failed to sync command metadata update', {
					commandId,
					attachmentId: attachment.id,
					guildId: attachment.discordServer.guildId,
					error: result.error,
				})
			}
		}
	}

	const command = await getCommandWithRelations(db, commandId)
	return c.json(command)
})

app.delete('/:id', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	const commandId = c.req.param('id')

	const command = await db.query.discordCommands.findFirst({
		where: eq(discordCommands.id, commandId),
		with: {
			serverAttachments: {
				with: {
					discordServer: true,
				},
			},
		},
	})
	if (!command) {
		return c.json({ error: 'Command not found' }, 404)
	}
	if (command.commandType === 'programmatic') {
		return c.json({ error: 'Programmatic commands cannot be deleted; disable them instead' }, 400)
	}

	for (const attachment of command.serverAttachments) {
		const deleteResult = await deleteGuildSlashCommand(c.env, attachment.discordServer.guildId, {
			commandId: attachment.discordCommandId ?? undefined,
			commandName: command.name,
		})
		if (!deleteResult.success) {
			return c.json(
				{
					error: 'Failed to delete command from Discord guild',
					details: deleteResult.error,
					guildId: attachment.discordServer.guildId,
				},
				502
			)
		}
	}

	await db.delete(discordCommands).where(eq(discordCommands.id, commandId))
	await refreshRegistryBestEffort(db, c.env)
	return c.json({ success: true })
})

app.get('/:id/servers', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	const commandId = c.req.param('id')

	const attachments = await db.query.discordServerCommands.findMany({
		where: eq(discordServerCommands.commandId, commandId),
		with: {
			discordServer: true,
		},
		orderBy: [desc(discordServerCommands.updatedAt)],
	})
	return c.json(attachments)
})

app.post('/:id/servers', async (c) => {
	const db = c.get('db')
	const user = c.get('user')!
	if (!db) return c.json({ error: 'Database not available' }, 500)

	const commandId = c.req.param('id')
	const parsed = serverAttachSchema.safeParse(await c.req.json())
	if (!parsed.success) {
		return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
	}

	const [command, server] = await Promise.all([
		db.query.discordCommands.findFirst({
			where: eq(discordCommands.id, commandId),
		}),
		db.query.discordServers.findFirst({
			where: eq(discordServers.id, parsed.data.serverId),
		}),
	])

	if (!command) return c.json({ error: 'Command not found' }, 404)
	if (!server) return c.json({ error: 'Discord server not found' }, 404)
	if (!command.isActive) {
		return c.json({ error: 'Inactive commands cannot be attached to a server' }, 400)
	}

	const existing = await db.query.discordServerCommands.findFirst({
		where: and(
			eq(discordServerCommands.commandId, commandId),
			eq(discordServerCommands.discordServerId, server.id)
		),
	})
	if (existing) {
		return c.json({ error: 'Command already attached to server' }, 409)
	}

	const registered = await upsertGuildSlashCommand(
		c.env,
		server.guildId,
		buildDiscordSlashCommandDefinition({
			name: command.name,
			description: command.description,
			commandType: command.commandType,
		})
	)

	const [created] = await db
		.insert(discordServerCommands)
		.values({
			commandId,
			discordServerId: server.id,
			discordCommandId: registered.id,
			createdBy: user.id,
		})
		.returning()

	await refreshRegistryBestEffort(db, c.env)
	return c.json(
		{
			...created,
			discordServer: server,
			discordRegistration: registered,
		},
		201
	)
})

app.delete('/:id/servers/:serverId', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	const commandId = c.req.param('id')
	const serverId = c.req.param('serverId')

	const attachment = await db.query.discordServerCommands.findFirst({
		where: and(
			eq(discordServerCommands.commandId, commandId),
			eq(discordServerCommands.discordServerId, serverId)
		),
		with: {
			command: true,
			discordServer: true,
		},
	})

	if (!attachment) {
		return c.json({ error: 'Command attachment not found' }, 404)
	}

	const deleteResult = await deleteGuildSlashCommand(c.env, attachment.discordServer.guildId, {
		commandId: attachment.discordCommandId ?? undefined,
		commandName: attachment.command.name,
	})

	if (!deleteResult.success) {
		return c.json(
			{
				error: 'Failed to delete command from Discord guild',
				details: deleteResult.error,
			},
			502
		)
	}

	await db.delete(discordServerCommands).where(eq(discordServerCommands.id, attachment.id))
	await refreshRegistryBestEffort(db, c.env)
	return c.json({ success: true })
})

app.post('/:id/sync', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	const commandId = c.req.param('id')

	const command = await db.query.discordCommands.findFirst({
		where: eq(discordCommands.id, commandId),
		with: {
			serverAttachments: {
				with: {
					discordServer: true,
				},
			},
		},
	})
	if (!command) return c.json({ error: 'Command not found' }, 404)

	const results: Array<{
		attachmentId: string
		serverId: string
		guildId: string
		success: boolean
		discordCommandId?: string
		error?: string
	}> = []

	for (const attachment of command.serverAttachments) {
		const result = await syncSingleCommandToAttachment(db, c.env, {
			commandId,
			attachmentId: attachment.id,
			guildId: attachment.discordServer.guildId,
			name: command.name,
			description: command.description,
			commandType: command.commandType,
			oldDiscordCommandId: attachment.discordCommandId,
		})

		results.push({
			attachmentId: attachment.id,
			serverId: attachment.discordServerId,
			guildId: attachment.discordServer.guildId,
			success: result.success,
			discordCommandId: result.discordCommandId,
			error: result.error,
		})
	}

	return c.json({
		success: results.every((result) => result.success),
		total: results.length,
		synced: results.filter((result) => result.success).length,
		failed: results.filter((result) => !result.success).length,
		results,
	})
})

app.post('/:id/register', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	const commandId = c.req.param('id')

	const command = await db.query.discordCommands.findFirst({
		where: eq(discordCommands.id, commandId),
		with: {
			serverAttachments: {
				with: {
					discordServer: true,
				},
			},
		},
	})
	if (!command) return c.json({ error: 'Command not found' }, 404)

	const results = await Promise.all(
		command.serverAttachments.map((attachment) =>
			syncSingleCommandToAttachment(db, c.env, {
				commandId,
				attachmentId: attachment.id,
				guildId: attachment.discordServer.guildId,
				name: command.name,
				description: command.description,
				commandType: command.commandType,
				oldDiscordCommandId: attachment.discordCommandId,
			})
		)
	)

	return c.json({
		success: results.every((result) => result.success),
		total: results.length,
		synced: results.filter((result) => result.success).length,
		failed: results.filter((result) => !result.success).length,
		results,
	})
})

export default app
