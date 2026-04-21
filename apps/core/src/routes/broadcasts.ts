import { Hono } from 'hono'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'
import { getBroadcastSystemTemplateToken } from '@repo/broadcasts'

import {
	getCachedUserPermissions,
} from '../lib/groups-cache'
import { validatePagination } from '../lib/validation'
import { requireAuth } from '../middleware/session'
import {
	canAccessBroadcastTargetByAction,
	buildBroadcastPermissionContext,
	canAccessBroadcastPermissionId,
	filterBroadcastTargetsByAction,
} from './broadcasts-permissions'

import type { Broadcasts } from '@repo/broadcasts'
import type { Groups, PermissionWithDetails } from '@repo/groups'
import type { App } from '../context'

const BROADCAST_PERMISSION_CATEGORY_NAME = 'broadcasts'
const BROADCAST_SEGMENT_PATTERN = /^[a-z0-9_-]+$/
const BROADCAST_GLOBAL_MANAGE_URN = 'urn:broadcasts:manage'
const BROADCAST_TEMPLATE_FIELD_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/
const BROADCAST_TEMPLATE_SELECT_LABEL_PATTERN = /^[a-zA-Z0-9_-]+$/

type ParsedTemplateToken =
	| {
			kind: 'text'
			rawToken: string
			normalizedToken: string
			name: string
			label: string
			type: 'text' | 'textarea'
	  }
	| {
			kind: 'system'
			rawToken: string
			normalizedToken: string
			name: string
			label: string
			type: 'system_doctrine' | 'system_staging' | 'system_srp'
			allowCustom?: boolean
	  }
	| {
			kind: 'select'
			rawToken: string
			normalizedToken: string
			name: string
			label: string
			type: 'select'
			options: string[]
	  }

interface ParsedTemplateResult {
	tokens: ParsedTemplateToken[]
	invalidTokens: string[]
	normalizedMessageTemplate: string
}

function extractTemplateTagBlocks(messageTemplate: string): string[] {
	return [...messageTemplate.matchAll(/\{\{([^}]*)\}\}/g)].map((match) => (match[1] ?? '').trim())
}

function parseTemplateMessage(messageTemplate: string): ParsedTemplateResult {
	const tokens: ParsedTemplateToken[] = []
	const invalidTokens = new Set<string>()
	const seenNames = new Set<string>()

	const normalizedMessageTemplate = messageTemplate.replace(
		/\{\{([^}]*)\}\}/g,
		(_fullMatch: string, tagContent: string) => {
			const rawToken = String(tagContent ?? '').trim()
			if (rawToken.length === 0) {
				invalidTokens.add(rawToken)
				return `{{${rawToken}}}`
			}

			const wrappedToken =
				rawToken.startsWith('<') && rawToken.endsWith('>')
					? rawToken.slice(1, -1).trim()
					: rawToken

			const systemToken = getBroadcastSystemTemplateToken(wrappedToken)
			if (systemToken) {
				if (!seenNames.has(systemToken.name)) {
					seenNames.add(systemToken.name)
					tokens.push({
						kind: 'system',
						rawToken,
						normalizedToken: systemToken.name,
						name: systemToken.name,
						label: systemToken.label,
						type: systemToken.fieldType,
						allowCustom: systemToken.allowCustom,
					})
				}
				return `{{<${systemToken.name}>}}`
			}

			if (wrappedToken.startsWith('select:')) {
				const selectBody = wrappedToken.slice('select:'.length)
				const firstSeparator = selectBody.indexOf(':')
				if (firstSeparator <= 0) {
					const labelName = selectBody.trim()
					if (!BROADCAST_TEMPLATE_SELECT_LABEL_PATTERN.test(labelName)) {
						invalidTokens.add(rawToken)
						return `{{${rawToken}}}`
					}
					const name = `select:${labelName}`
					if (!seenNames.has(name)) {
						seenNames.add(name)
						tokens.push({
							kind: 'select',
							rawToken,
							normalizedToken: name,
							name,
							label: toTemplateFieldLabel(labelName),
							type: 'select',
							options: [],
						})
					}
					return `{{<${name}>}}`
				}

				const labelName = selectBody.slice(0, firstSeparator).trim()
				const optionsText = selectBody.slice(firstSeparator + 1).trim()
				const options = optionsText
					.split('|')
					.map((option) => toTemplateFieldLabel(option.trim()))
					.filter(Boolean)

				if (
					!BROADCAST_TEMPLATE_SELECT_LABEL_PATTERN.test(labelName) ||
					options.length === 0
				) {
					invalidTokens.add(rawToken)
					return `{{${rawToken}}}`
				}

				const name = `select:${labelName}`
				if (!seenNames.has(name)) {
					seenNames.add(name)
					tokens.push({
						kind: 'select',
						rawToken,
						normalizedToken: name,
						name,
						label: toTemplateFieldLabel(labelName),
						type: 'select',
						options,
					})
				}
				return `{{<${name}>}}`
			}

			if (BROADCAST_TEMPLATE_FIELD_NAME_PATTERN.test(wrappedToken)) {
				const name = wrappedToken
				if (!seenNames.has(name)) {
					seenNames.add(name)
					tokens.push({
						kind: 'text',
						rawToken,
						normalizedToken: name,
						name,
						label: toTemplateFieldLabel(name),
						type: name.toLowerCase() === 'message' ? 'textarea' : 'text',
					})
				}
				return `{{${name}}}`
			}

			invalidTokens.add(rawToken)
			return `{{${rawToken}}}`
		}
	)

	return {
		tokens,
		invalidTokens: [...invalidTokens],
		normalizedMessageTemplate,
	}
}

function getInvalidTemplateTagNames(messageTemplate: string): string[] {
	return parseTemplateMessage(messageTemplate).invalidTokens
}

function getTemplateFieldSchemaNames(fieldSchema: unknown): string[] {
	if (!Array.isArray(fieldSchema)) return []
	return fieldSchema
		.map((field) => (typeof field === 'object' && field !== null ? (field as { name?: unknown }).name : null))
		.filter((name): name is string => typeof name === 'string')
}

function toTemplateFieldLabel(name: string): string {
	const normalized = name
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/\s+/g, ' ')
		.trim()
	if (!normalized) return name
	return normalized
		.split(' ')
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join(' ')
}

function deriveTemplateFieldSchema(
	messageTemplate: string,
	existingFieldSchema: unknown
): Array<{
	name: string
	label: string
	type:
		| 'text'
		| 'textarea'
		| 'select'
		| 'system_doctrine'
		| 'system_staging'
		| 'system_srp'
		| 'system_frogsiren'
	required: boolean
	options?: string[]
	allowCustom?: boolean
}> {
	const parsed = parseTemplateMessage(messageTemplate)
	const existingByName = new Map<
		string,
		{
			label?: string
			type?: string
			required?: boolean
			options?: string[]
			allowCustom?: boolean
		}
	>()

	if (Array.isArray(existingFieldSchema)) {
		for (const field of existingFieldSchema) {
			if (!field || typeof field !== 'object') continue
			const typed = field as { name?: unknown; label?: unknown; type?: unknown; required?: unknown }
			if (typeof typed.name !== 'string') continue
			existingByName.set(typed.name, {
				label: typeof typed.label === 'string' ? typed.label : undefined,
				type: typeof typed.type === 'string' ? typed.type : undefined,
				required: typeof typed.required === 'boolean' ? typed.required : undefined,
				options: Array.isArray((typed as { options?: unknown }).options)
					? ((typed as { options: unknown[] }).options.filter(
							(value): value is string => typeof value === 'string'
						) ?? [])
					: undefined,
				allowCustom:
					typeof (typed as { allowCustom?: unknown }).allowCustom === 'boolean'
						? Boolean((typed as { allowCustom?: boolean }).allowCustom)
						: undefined,
			})
		}
	}

	const fields = parsed.tokens.map((token) => {
		const existing = existingByName.get(token.name)
		let type:
			| 'text'
			| 'textarea'
			| 'select'
			| 'system_doctrine'
			| 'system_staging'
			| 'system_srp'
			| 'system_frogsiren' = token.type
		if (
			existing?.type === 'text' ||
			existing?.type === 'textarea' ||
			existing?.type === 'select' ||
			existing?.type === 'system_doctrine' ||
			existing?.type === 'system_staging' ||
			existing?.type === 'system_srp' ||
			existing?.type === 'system_frogsiren'
		) {
			type = existing.type
		}

		const baseField = {
			name: token.name,
			label: existing?.label ?? token.label,
			type,
			required: existing?.required ?? true,
		} as {
			name: string
			label: string
			type:
				| 'text'
				| 'textarea'
				| 'select'
				| 'system_doctrine'
				| 'system_staging'
				| 'system_srp'
				| 'system_frogsiren'
			required: boolean
			options?: string[]
			allowCustom?: boolean
		}

		if (token.kind === 'system' && token.allowCustom) {
			baseField.allowCustom = true
		}
		if (token.kind === 'select') {
			if (token.options.length > 0) {
				baseField.options = token.options
			} else if (Array.isArray(existing?.options) && existing.options.length > 0) {
				baseField.options = existing.options
			} else {
				baseField.options = []
			}
		} else if (Array.isArray(existing?.options) && existing.options.length > 0) {
			baseField.options = existing.options
		}

		return baseField
	})

	const frogsirenField = Array.isArray(existingFieldSchema)
		? existingFieldSchema.find((field) => {
				if (!field || typeof field !== 'object') return false
				const typed = field as { type?: unknown; name?: unknown }
				return typed.type === 'system_frogsiren' && typed.name === '__frogsirenEnabled'
			})
		: null

	if (frogsirenField && typeof frogsirenField === 'object') {
		fields.push({
			name: '__frogsirenEnabled',
			label: 'FrogSiren',
			type: 'system_frogsiren',
			required: false,
		})
	}

	return fields
}

function normalizeTemplateTargetIds(payload: Record<string, unknown>): string[] {
	const targetIdsFromArray = Array.isArray(payload.targetIds)
		? payload.targetIds.filter((value): value is string => typeof value === 'string')
		: []
	const singleTargetId =
		typeof payload.targetId === 'string' && payload.targetId.trim().length > 0
			? [payload.targetId]
			: []

	return [...new Set([...targetIdsFromArray, ...singleTargetId].map((value) => value.trim()).filter(Boolean))]
}

/**
 * Resolve user's effective permission URNs.
 */
async function getUserPermissionUrnSet(
	env: { GROUPS: DurableObjectNamespace },
	userId: string
): Promise<Set<string>> {
	const permissions = await getCachedUserPermissions(env, userId)
	return new Set(permissions.map((permission) => permission.urn))
}

function validateBroadcastPermissionSegment(value: string, label: string): string | null {
	if (!value || !BROADCAST_SEGMENT_PATTERN.test(value)) {
		return `${label} must match ^[a-z0-9_-]+$`
	}
	return null
}

function buildBroadcastPermissionUrns(
	entityNamespace: string,
	targetName: string
): {
	sendUrn: string
	manageUrn: string
} {
	return {
		sendUrn: `urn:broadcasts:${entityNamespace}:${targetName}:send`,
		manageUrn: `urn:broadcasts:${entityNamespace}:${targetName}:manage`,
	}
}

async function getBroadcastPermissionCategoryId(groupsStub: Groups): Promise<string> {
	const categories = await groupsStub.listPermissionCategories()
	const broadcastCategory = categories.find(
		(category) => category.name.trim().toLowerCase() === BROADCAST_PERMISSION_CATEGORY_NAME
	)
	if (!broadcastCategory) {
		throw new Error('Broadcasts permission category not found')
	}
	return broadcastCategory.id
}

async function resolveOrCreateBroadcastPermissionPair(
	env: { GROUPS: DurableObjectNamespace },
	actorUserId: string,
	entityNamespace: string,
	targetName: string,
	allowCreate: boolean
): Promise<{ sendPermissionId: string; managePermissionId: string }> {
	const { sendUrn, manageUrn } = buildBroadcastPermissionUrns(entityNamespace, targetName)
	const groupsStub = getStub<Groups>(env.GROUPS, 'default')
	const broadcastCategoryId = await getBroadcastPermissionCategoryId(groupsStub)

	const findByUrn = async (): Promise<Map<string, PermissionWithDetails>> => {
		const permissions = await groupsStub.listPermissions(broadcastCategoryId)
		return new Map(permissions.map((permission) => [permission.urn, permission]))
	}

	const tryCreate = async (urn: string, name: string): Promise<void> => {
		try {
			await groupsStub.createPermission(
				{
					urn,
					name,
					categoryId: broadcastCategoryId,
				},
				actorUserId
			)
		} catch {
			// Ignore race/duplicate errors; we'll re-read by URN below.
		}
	}

	let byUrn = await findByUrn()
	let sendPermission = byUrn.get(sendUrn)
	let managePermission = byUrn.get(manageUrn)

	if ((!sendPermission || !managePermission) && !allowCreate) {
		throw new Error('Missing broadcast permissions for this target scope')
	}

	if (!sendPermission) {
		await tryCreate(sendUrn, `Can send ${targetName} broadcasts`)
	}
	if (!managePermission) {
		await tryCreate(manageUrn, `Can manage ${targetName} broadcasts`)
	}

	byUrn = await findByUrn()
	sendPermission = byUrn.get(sendUrn)
	managePermission = byUrn.get(manageUrn)

	if (!sendPermission || !managePermission) {
		throw new Error('Failed to resolve broadcast send/manage permissions')
	}

	return {
		sendPermissionId: sendPermission.id,
		managePermissionId: managePermission.id,
	}
}

async function getUserBroadcastPermissionContext(
	env: { GROUPS: DurableObjectNamespace },
	userId: string
): Promise<ReturnType<typeof buildBroadcastPermissionContext>> {
	const userPermissions = await getCachedUserPermissions(env, userId)
	return buildBroadcastPermissionContext(userPermissions)
}

/**
 * Broadcasts routes
 *
 * Provides API endpoints for managing broadcast targets, templates, and broadcasts.
 * All requests are authenticated and permission-checked before being forwarded to the Broadcasts DO.
 */
const broadcasts = new Hono<App>()

// Apply authentication middleware to all routes
broadcasts.use('*', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }))

// =============================================================================
// BROADCAST TARGETS
// =============================================================================

/**
 * List all broadcast targets
 * GET /api/broadcasts/targets
 *
 * Only returns targets with permission IDs available to user (unless admin)
 */
broadcasts.get('/targets', async (c) => {
	const user = c.get('user')!

	const permissionContext = user.is_admin
		? null
		: await getUserBroadcastPermissionContext(c.env, user.id)

	if (
		!user.is_admin &&
		permissionContext &&
		permissionContext.accessiblePermissionIdsByAction.get('send')?.size === 0 &&
		!permissionContext.hasGlobalManage
	) {
		return c.json([])
	}

	// Get Broadcasts DO stub
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const targets = await broadcastsStub.listTargets(
		user.id,
		user.is_admin
			? undefined
			: [...(permissionContext!.accessiblePermissionIdsByAction.get('send') ?? new Set())]
	)

	// Filter targets to only include targets gated by permission IDs user has
	const filteredTargets = user.is_admin
		? targets
		: filterBroadcastTargetsByAction(targets, 'send', permissionContext!)

	return c.json(filteredTargets)
})

/**
 * Get a single broadcast target by ID
 * GET /api/broadcasts/targets/:id
 */
broadcasts.get('/targets/:id', async (c) => {
	const user = c.get('user')!
	const targetId = c.req.param('id')

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const target = await broadcastsStub.getTarget(targetId, user.id)

	if (!target) {
		return c.json({ error: 'Target not found' }, 404)
	}

	// Verify user has target's permission ID attached
	if (!user.is_admin) {
		const permissionContext = await getUserBroadcastPermissionContext(c.env, user.id)
		const canAccessTarget = canAccessBroadcastTargetByAction(target, 'send', permissionContext)

		if (!canAccessTarget) {
			return c.json({ error: 'Permission denied' }, 403)
		}
	}

	return c.json(target)
})

/**
 * Create a new broadcast target
 * POST /api/broadcasts/targets
 */
broadcasts.post('/targets', async (c) => {
	const user = c.get('user')!
	const data = await c.req.json<{
		name: string
		description?: string
		type: 'discord_channel'
		permissionEntityNamespace: string
		permissionTargetName: string
		displayOrder?: number
		config: { guildId: string; channelId: string }
	}>()

	const entityNamespace = String(data.permissionEntityNamespace ?? '').trim()
	const targetName = String(data.permissionTargetName ?? '').trim()
	const entityNamespaceError = validateBroadcastPermissionSegment(
		entityNamespace,
		'permissionEntityNamespace'
	)
	if (entityNamespaceError) return c.json({ error: entityNamespaceError }, 400)
	const targetNameError = validateBroadcastPermissionSegment(targetName, 'permissionTargetName')
	if (targetNameError) return c.json({ error: targetNameError }, 400)
	const displayOrder =
		typeof data.displayOrder === 'number' && Number.isFinite(data.displayOrder)
			? Math.trunc(data.displayOrder)
			: 0

	const userPermissionUrns = user.is_admin
		? new Set<string>()
		: await getUserPermissionUrnSet(c.env, user.id)
	const hasGlobalManage = user.is_admin || userPermissionUrns.has(BROADCAST_GLOBAL_MANAGE_URN)

	let sendPermissionId: string
	let managePermissionId: string
	try {
		const resolved = await resolveOrCreateBroadcastPermissionPair(
			c.env,
			user.id,
			entityNamespace,
			targetName,
			hasGlobalManage
		)
		sendPermissionId = resolved.sendPermissionId
		managePermissionId = resolved.managePermissionId
	} catch (error) {
		if (error instanceof Error && error.message.includes('Missing broadcast permissions')) {
			return c.json({ error: 'Permission denied' }, 403)
		}
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}

	// Creating/editing targets requires manage-level permission for the selected broadcast scope
	const permissionContext = user.is_admin
		? null
		: await getUserBroadcastPermissionContext(c.env, user.id)
	const allowed = user.is_admin
		? true
		: hasGlobalManage ||
			canAccessBroadcastPermissionId(managePermissionId, 'manage', permissionContext!)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const target = await broadcastsStub.createTarget(
		{
			name: data.name,
			description: data.description,
			type: data.type,
			permissionEntityNamespace: entityNamespace,
			permissionTargetName: targetName,
			displayOrder,
			sendPermissionId,
			managePermissionId,
			config: data.config,
		},
		user.id
	)

	return c.json(target, 201)
})

/**
 * Update a broadcast target
 * PATCH /api/broadcasts/targets/:id
 */
broadcasts.patch('/targets/:id', async (c) => {
	const user = c.get('user')!
	const targetId = c.req.param('id')
	const payload = await c.req.json<
		{
			sendPermissionUrn?: string
			managePermissionUrn?: string
		} & Record<string, unknown>
	>()
	const data: Record<string, unknown> = { ...payload }
	delete data.sendPermissionUrn
	delete data.managePermissionUrn
	if (data.displayOrder !== undefined) {
		const parsedDisplayOrder =
			typeof data.displayOrder === 'number' && Number.isFinite(data.displayOrder)
				? Math.trunc(data.displayOrder)
				: Number.NaN
		if (Number.isNaN(parsedDisplayOrder)) {
			return c.json({ error: 'displayOrder must be a finite number' }, 400)
		}
		data.displayOrder = parsedDisplayOrder
	}

	// Get target to check ownership scope
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const target = await broadcastsStub.getTarget(targetId, user.id)

	if (!target) {
		return c.json({ error: 'Target not found' }, 404)
	}

	// Check permission on existing target permission ID
	const allowed = user.is_admin
		? true
		: canAccessBroadcastPermissionId(
				target.managePermissionId,
				'manage',
				await getUserBroadcastPermissionContext(c.env, user.id)
			)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	try {
		const sendPermissionUrn = String(payload.sendPermissionUrn ?? '').trim()
		const managePermissionUrn = String(payload.managePermissionUrn ?? '').trim()
		if (sendPermissionUrn || managePermissionUrn) {
			const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
			const broadcastCategoryId = await getBroadcastPermissionCategoryId(groupsStub)
			const permissions = await groupsStub.listPermissions(broadcastCategoryId)
			const permissionByUrn = new Map(
				permissions.map((permission) => [permission.urn, permission.id])
			)

			if (sendPermissionUrn) {
				const sendPermissionId = permissionByUrn.get(sendPermissionUrn)
				if (!sendPermissionId) {
					return c.json({ error: `Broadcast send permission not found: ${sendPermissionUrn}` }, 400)
				}
				data.sendPermissionId = sendPermissionId
			}

			if (managePermissionUrn) {
				const managePermissionId = permissionByUrn.get(managePermissionUrn)
				if (!managePermissionId) {
					return c.json(
						{ error: `Broadcast manage permission not found: ${managePermissionUrn}` },
						400
					)
				}
				data.managePermissionId = managePermissionId
			}
		}
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}

	// If re-scoping target permissions, user must hold matching access for each new permission ID
	if (!user.is_admin) {
		const context = await getUserBroadcastPermissionContext(c.env, user.id)
		if (
			data.sendPermissionId &&
			data.sendPermissionId !== target.sendPermissionId &&
			!canAccessBroadcastPermissionId(String(data.sendPermissionId), 'send', context)
		) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		if (
			data.managePermissionId &&
			data.managePermissionId !== target.managePermissionId &&
			!canAccessBroadcastPermissionId(String(data.managePermissionId), 'manage', context)
		) {
			return c.json({ error: 'Permission denied' }, 403)
		}
	}

	const updated = await broadcastsStub.updateTarget(
		targetId,
		data as Parameters<Broadcasts['updateTarget']>[1],
		user.id
	)
	return c.json(updated)
})

/**
 * Delete a broadcast target
 * DELETE /api/broadcasts/targets/:id
 */
broadcasts.delete('/targets/:id', async (c) => {
	const user = c.get('user')!
	const targetId = c.req.param('id')

	// Get target to check ownership scope
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const target = await broadcastsStub.getTarget(targetId, user.id)

	if (!target) {
		return c.json({ error: 'Target not found' }, 404)
	}

	// Check permissions
	const allowed = user.is_admin
		? true
		: canAccessBroadcastPermissionId(
				target.managePermissionId,
				'manage',
				await getUserBroadcastPermissionContext(c.env, user.id)
			)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	await broadcastsStub.deleteTarget(targetId, user.id)
	return c.json({ success: true })
})

// =============================================================================
// BROADCAST TEMPLATES
// =============================================================================

/**
 * List broadcast templates (optionally filtered by targetType and/or targetId)
 * GET /api/broadcasts/templates?targetType=xxx&targetId=xxx
 */
broadcasts.get('/templates', async (c) => {
	const user = c.get('user')!
	const targetType = c.req.query('targetType')
	const targetId = c.req.query('targetId')
	const permissionContext = user.is_admin
		? null
		: await getUserBroadcastPermissionContext(c.env, user.id)

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	if (targetId && !user.is_admin) {
		const target = await broadcastsStub.getTarget(targetId, user.id)
		if (!target) {
			return c.json({ error: 'Target not found' }, 404)
		}
		const canAccessTarget = canAccessBroadcastTargetByAction(target, 'send', permissionContext!)
		if (!canAccessTarget) {
			return c.json({ error: 'Permission denied' }, 403)
		}
	}

	const templates = await broadcastsStub.listTemplates(user.id, { targetType, targetId })

	if (user.is_admin) {
		return c.json(templates)
	}

	const allowedSendPermissionIds = [
		...(permissionContext!.accessiblePermissionIdsByAction.get('send') ?? new Set()),
	]
	const accessibleTargets = await broadcastsStub.listTargets(user.id, allowedSendPermissionIds)
	const accessibleTargetIds = new Set(accessibleTargets.map((target) => target.id))
	const filteredTemplates = templates.filter((template) =>
		template.targetIds.some((templateTargetId) => accessibleTargetIds.has(templateTargetId))
	)

	return c.json(filteredTemplates)
})

/**
 * Get a single template by ID
 * GET /api/broadcasts/templates/:id
 */
broadcasts.get('/templates/:id', async (c) => {
	const user = c.get('user')!
	const templateId = c.req.param('id')

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const template = await broadcastsStub.getTemplate(templateId, user.id)

	if (!template) {
		return c.json({ error: 'Template not found' }, 404)
	}

	// Verify user can send to this template's target
	if (!user.is_admin) {
		const permissionContext = await getUserBroadcastPermissionContext(c.env, user.id)
		const templateTargets = await Promise.all(
			template.targetIds.map((templateTargetId) => broadcastsStub.getTarget(templateTargetId, user.id))
		)
		const resolvedTemplateTargets = templateTargets.filter(
			(target): target is NonNullable<typeof target> => Boolean(target)
		)
		const canAccessAnyTarget = resolvedTemplateTargets.some((target) =>
			canAccessBroadcastTargetByAction(target, 'send', permissionContext)
		)
		if (!canAccessAnyTarget) {
			return c.json({ error: 'Permission denied' }, 403)
		}
	}

	return c.json(template)
})

/**
 * Create a new broadcast template
 * POST /api/broadcasts/templates
 */
broadcasts.post('/templates', async (c) => {
	const user = c.get('user')!
	const data = (await c.req.json()) as Record<string, unknown>
	if (typeof data.name !== 'string' || data.name.trim().length === 0) {
		return c.json({ error: 'name is required' }, 400)
	}
	if (typeof data.messageTemplate !== 'string') {
		return c.json({ error: 'messageTemplate is required' }, 400)
	}
	const parsedCreateTemplate = parseTemplateMessage(data.messageTemplate)
	const displayOrder =
		typeof data.displayOrder === 'number' && Number.isFinite(data.displayOrder)
			? Math.trunc(data.displayOrder)
			: data.displayOrder === undefined
				? 0
				: Number.NaN
	if (Number.isNaN(displayOrder)) {
		return c.json({ error: 'displayOrder must be a finite number' }, 400)
	}
	const targetIds = normalizeTemplateTargetIds(data)
	if (targetIds.length === 0) {
		return c.json({ error: 'At least one target is required' }, 400)
	}
	const invalidTagNames = parsedCreateTemplate.invalidTokens
	if (invalidTagNames.length > 0) {
		return c.json(
			{
				error: `Invalid template tag name(s): ${invalidTagNames.join(', ')}. Tag names must be alphanumeric and may include "_" or "-".`,
			},
			400
		)
	}

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const targets = await Promise.all(targetIds.map((targetId) => broadcastsStub.getTarget(targetId, user.id)))
	if (targets.some((target) => !target)) {
		return c.json({ error: 'One or more targets not found' }, 404)
	}
	const resolvedTargets = targets.filter((target): target is NonNullable<typeof target> => Boolean(target))
	const targetType = resolvedTargets[0]?.type
	if (!targetType || resolvedTargets.some((target) => target.type !== targetType)) {
		return c.json({ error: 'All selected targets must share the same target type' }, 400)
	}

	// Check permissions against target's manage permission
	const permissionContext = user.is_admin
		? null
		: await getUserBroadcastPermissionContext(c.env, user.id)
	const allowed = user.is_admin
		? true
		: resolvedTargets.every((target) =>
				canAccessBroadcastTargetByAction(target, 'manage', permissionContext!)
			)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	const template = await broadcastsStub.createTemplate(
		{
			name: data.name.trim(),
			description: typeof data.description === 'string' ? data.description : undefined,
			targetType,
			displayOrder,
			targetIds,
			fieldSchema: deriveTemplateFieldSchema(
				data.messageTemplate,
				data.fieldSchema
			),
			messageTemplate: data.messageTemplate,
		},
		user.id
	)

	return c.json(template, 201)
})

/**
 * Update a broadcast template
 * PATCH /api/broadcasts/templates/:id
 */
broadcasts.patch('/templates/:id', async (c) => {
	const user = c.get('user')!
	const templateId = c.req.param('id')
	const data = (await c.req.json()) as Record<string, unknown>
	if (data.displayOrder !== undefined) {
		const parsedDisplayOrder =
			typeof data.displayOrder === 'number' && Number.isFinite(data.displayOrder)
				? Math.trunc(data.displayOrder)
				: Number.NaN
		if (Number.isNaN(parsedDisplayOrder)) {
			return c.json({ error: 'displayOrder must be a finite number' }, 400)
		}
		data.displayOrder = parsedDisplayOrder
	}

	// Get template to check group ownership
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const template = await broadcastsStub.getTemplate(templateId, user.id)

	if (!template) {
		return c.json({ error: 'Template not found' }, 404)
	}
	const nextTargetIds = data.targetIds !== undefined || data.targetId !== undefined
		? normalizeTemplateTargetIds(data)
		: template.targetIds
	if (nextTargetIds.length === 0) {
		return c.json({ error: 'At least one target is required' }, 400)
	}

	const currentTargets = await Promise.all(
		template.targetIds.map((templateTargetId) => broadcastsStub.getTarget(templateTargetId, user.id))
	)
	const resolvedCurrentTargets = currentTargets.filter(
		(target): target is NonNullable<typeof target> => Boolean(target)
	)
	const proposedTargets = await Promise.all(
		nextTargetIds.map((templateTargetId) => broadcastsStub.getTarget(templateTargetId, user.id))
	)
	if (proposedTargets.some((target) => !target)) {
		return c.json({ error: 'One or more targets not found' }, 404)
	}
	const resolvedProposedTargets = proposedTargets.filter(
		(target): target is NonNullable<typeof target> => Boolean(target)
	)
	if (resolvedProposedTargets.some((target) => target.type !== template.targetType)) {
		return c.json({ error: 'All selected targets must match the template target type' }, 400)
	}

	// Check permissions against target's manage permission
	const permissionContext = user.is_admin
		? null
		: await getUserBroadcastPermissionContext(c.env, user.id)
	const allowed = user.is_admin
		? true
		: [...resolvedCurrentTargets, ...resolvedProposedTargets].every((target) =>
				canAccessBroadcastTargetByAction(target, 'manage', permissionContext!)
			)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	const nextMessageTemplate =
		typeof data.messageTemplate === 'string' ? data.messageTemplate : template.messageTemplate
	const parsedNextTemplate = parseTemplateMessage(nextMessageTemplate)
	const invalidTagNames = parsedNextTemplate.invalidTokens
	if (invalidTagNames.length > 0) {
		return c.json(
			{
				error: `Invalid template tag name(s): ${invalidTagNames.join(', ')}. Tag names must be alphanumeric and may include "_" or "-".`,
			},
			400
		)
	}

	const shouldNormalizeFieldSchema =
		data.messageTemplate !== undefined || data.fieldSchema !== undefined

	const updatePayload: Parameters<Broadcasts['updateTemplate']>[1] = {
		targetIds: nextTargetIds,
	}
	if (typeof data.name === 'string') {
		updatePayload.name = data.name
	}
	if (typeof data.description === 'string' || data.description === null) {
		updatePayload.description = data.description ?? undefined
	}
	if (typeof data.displayOrder === 'number') {
		updatePayload.displayOrder = data.displayOrder
	}
	if (typeof data.messageTemplate === 'string') {
		updatePayload.messageTemplate = data.messageTemplate
	}
	if (shouldNormalizeFieldSchema) {
		updatePayload.fieldSchema = deriveTemplateFieldSchema(
			nextMessageTemplate,
			data.fieldSchema ?? template.fieldSchema
		)
	}

	const updated = await broadcastsStub.updateTemplate(
		templateId,
		updatePayload,
		user.id
	)
	return c.json(updated)
})

/**
 * Delete a broadcast template
 * DELETE /api/broadcasts/templates/:id
 */
broadcasts.delete('/templates/:id', async (c) => {
	const user = c.get('user')!
	const templateId = c.req.param('id')

	// Get template to check group ownership
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const template = await broadcastsStub.getTemplate(templateId, user.id)

	if (!template) {
		return c.json({ error: 'Template not found' }, 404)
	}
	const targets = await Promise.all(
		template.targetIds.map((templateTargetId) => broadcastsStub.getTarget(templateTargetId, user.id))
	)
	const resolvedTargets = targets.filter((target): target is NonNullable<typeof target> => Boolean(target))

	// Check permissions against target's manage permission
	const permissionContext = user.is_admin
		? null
		: await getUserBroadcastPermissionContext(c.env, user.id)
	const allowed = user.is_admin
		? true
		: resolvedTargets.every((target) =>
				canAccessBroadcastTargetByAction(target, 'manage', permissionContext!)
			)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	await broadcastsStub.deleteTemplate(templateId, user.id)
	return c.json({ success: true })
})

// =============================================================================
// BROADCASTS
// =============================================================================

/**
 * List broadcasts (optionally filtered by permissionId and/or status)
 * GET /api/broadcasts?permissionId=xxx&status=xxx
 *
 * Only returns broadcasts whose permission ID is attached to user (unless admin)
 */
broadcasts.get('/', async (c) => {
	const user = c.get('user')!
	const permissionId = c.req.query('permissionId')
	const status = c.req.query('status') as any
	const mine = c.req.query('mine') === 'true'
	const targetId = c.req.query('targetId')
	const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))

	if (!pagination.success) {
		return c.json({ error: pagination.error }, pagination.status)
	}

	const permissionContext = user.is_admin
		? null
		: await getUserBroadcastPermissionContext(c.env, user.id)

	// If filtering by a specific permission ID, verify user has it
	if (permissionId) {
		if (
			!user.is_admin &&
			!canAccessBroadcastPermissionId(permissionId, 'send', permissionContext!)
		) {
			return c.json({ error: 'Permission denied' }, 403)
		}
	}

	if (
		!user.is_admin &&
		!permissionId &&
		permissionContext &&
		permissionContext.accessiblePermissionIdsByAction.get('send')?.size === 0 &&
		!permissionContext.hasGlobalManage
	) {
		return c.json({ rows: [], rowCount: 0 })
	}

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const page = await broadcastsStub.listBroadcasts(user.id, {
		permissionId,
		permissionIds:
			user.is_admin || permissionId
				? undefined
				: [...(permissionContext!.accessiblePermissionIdsByAction.get('send') ?? new Set())],
		status,
		targetId,
		createdBy: mine ? user.id : undefined,
		limit: pagination.data.limit,
		offset: pagination.data.offset,
	})

	return c.json(page)
})

/**
 * Get a single broadcast with full details
 * GET /api/broadcasts/:id
 */
broadcasts.get('/:id', async (c) => {
	const user = c.get('user')!
	const broadcastId = c.req.param('id')

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const broadcast = await broadcastsStub.getBroadcast(broadcastId, user.id)

	if (!broadcast) {
		return c.json({ error: 'Broadcast not found' }, 404)
	}

	// Verify user has the broadcast permission ID
	if (!user.is_admin) {
		const permissionContext = await getUserBroadcastPermissionContext(c.env, user.id)
		const canView = canAccessBroadcastTargetByAction(broadcast.target, 'send', permissionContext)

		if (!canView) {
			return c.json({ error: 'Not authorized to view this broadcast' }, 403)
		}
	}

	return c.json(broadcast)
})

/**
 * Create a new broadcast
 * POST /api/broadcasts
 */
broadcasts.post('/', async (c) => {
	const user = c.get('user')!
	const data = await c.req.json()

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const target = await broadcastsStub.getTarget(data.targetId, user.id)
	if (!target) {
		return c.json({ error: 'Target not found' }, 404)
	}
	if (typeof data.templateId === 'string' && data.templateId.length > 0) {
		const template = await broadcastsStub.getTemplate(data.templateId, user.id)
		if (!template) {
			return c.json({ error: 'Template not found' }, 404)
		}
		if (!template.targetIds.includes(data.targetId)) {
			return c.json({ error: 'Template is not attached to the selected target' }, 400)
		}
	}

	// Check permissions against target's assigned permission ID
	const allowed = user.is_admin
		? true
		: canAccessBroadcastTargetByAction(
				target,
				'send',
				await getUserBroadcastPermissionContext(c.env, user.id)
			)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	// Get main character name
	const mainCharacter = user.characters.find((c) => c.is_primary)
	const createdByCharacterName = mainCharacter?.characterName || 'Unknown'

	const broadcast = await broadcastsStub.createBroadcast(
		{ ...data, permissionId: target.sendPermissionId, createdByCharacterName },
		user.id
	)

	return c.json(broadcast, 201)
})

/**
 * Update a draft broadcast
 * PATCH /api/broadcasts/:id
 */
broadcasts.patch('/:id', async (c) => {
	const user = c.get('user')!
	const broadcastId = c.req.param('id')
	const data = await c.req.json()

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const broadcast = await broadcastsStub.getBroadcast(broadcastId, user.id)

	if (!broadcast) {
		return c.json({ error: 'Broadcast not found' }, 404)
	}

	if (broadcast.status !== 'draft') {
		return c.json({ error: 'Only draft broadcasts can be edited' }, 409)
	}

	const allowed = user.is_admin
		? true
		: canAccessBroadcastTargetByAction(
				broadcast.target,
				'send',
				await getUserBroadcastPermissionContext(c.env, user.id)
			)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	try {
		const updated = await broadcastsStub.updateBroadcast(broadcastId, data, user.id)
		return c.json(updated)
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}
})

/**
 * Send a broadcast immediately
 * POST /api/broadcasts/:id/send
 */
broadcasts.post('/:id/send', async (c) => {
	const user = c.get('user')!
	const broadcastId = c.req.param('id')

	// Get broadcast to check ownership scope
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const broadcast = await broadcastsStub.getBroadcast(broadcastId, user.id)

	if (!broadcast) {
		return c.json({ error: 'Broadcast not found' }, 404)
	}

	// Check permissions
	const allowed = user.is_admin
		? true
		: canAccessBroadcastTargetByAction(
				broadcast.target,
				'send',
				await getUserBroadcastPermissionContext(c.env, user.id)
			)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	// Send broadcast
	const result = await broadcastsStub.sendBroadcast(broadcastId, user.id)

	return c.json(result)
})

/**
 * Delete a broadcast
 * DELETE /api/broadcasts/:id
 */
broadcasts.delete('/:id', async (c) => {
	const user = c.get('user')!
	const broadcastId = c.req.param('id')

	// Get broadcast to check ownership scope
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const broadcast = await broadcastsStub.getBroadcast(broadcastId, user.id)

	if (!broadcast) {
		return c.json({ error: 'Broadcast not found' }, 404)
	}

	// Check permissions
	const allowed = user.is_admin
		? true
		: canAccessBroadcastPermissionId(
				broadcast.target.managePermissionId,
				'manage',
				await getUserBroadcastPermissionContext(c.env, user.id)
			)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	await broadcastsStub.deleteBroadcast(broadcastId, user.id)
	return c.json({ success: true })
})

/**
 * Rescind a sent broadcast
 * POST /api/broadcasts/:id/rescind
 */
broadcasts.post('/:id/rescind', async (c) => {
	const user = c.get('user')!
	const broadcastId = c.req.param('id')

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const broadcast = await broadcastsStub.getBroadcast(broadcastId, user.id)

	if (!broadcast) {
		return c.json({ error: 'Broadcast not found' }, 404)
	}

	const isOwner = broadcast.createdBy === user.id
	const allowed = user.is_admin
		? true
		: isOwner ||
			canAccessBroadcastPermissionId(
				broadcast.target.managePermissionId,
				'manage',
				await getUserBroadcastPermissionContext(c.env, user.id)
			)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	if (broadcast.status !== 'sent') {
		return c.json({ error: 'Only sent broadcasts can be rescinded' }, 400)
	}

	const body = await c.req.json().catch(() => ({}))
	const rescindMessage = typeof body?.rescindMessage === 'string' ? body.rescindMessage : undefined

	await broadcastsStub.rescindBroadcast(broadcastId, user.id, rescindMessage)
	return c.json({ success: true })
})

/**
 * Get deliveries for a broadcast
 * GET /api/broadcasts/:id/deliveries
 */
broadcasts.get('/:id/deliveries', async (c) => {
	const user = c.get('user')!
	const broadcastId = c.req.param('id')

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')

	// First, get the broadcast to check its permission scope
	const broadcast = await broadcastsStub.getBroadcast(broadcastId, user.id)

	if (!broadcast) {
		return c.json({ error: 'Broadcast not found' }, 404)
	}

	// Verify user has the broadcast permission ID
	if (!user.is_admin) {
		const permissionContext = await getUserBroadcastPermissionContext(c.env, user.id)
		const canView = canAccessBroadcastTargetByAction(broadcast.target, 'send', permissionContext)

		if (!canView) {
			return c.json({ error: 'Not authorized to view this broadcast' }, 403)
		}
	}

	const deliveries = await broadcastsStub.getDeliveries(broadcastId, user.id)

	return c.json(deliveries)
})

export default broadcasts
