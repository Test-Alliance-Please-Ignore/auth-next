/**
 * @repo/broadcasts
 *
 * Shared types and interfaces for the Broadcasts Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

// =============================================================================
// ENUMS & TYPES
// =============================================================================

export type TargetType = 'discord_channel'
export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed'
export type DeliveryStatus = 'pending' | 'sent' | 'failed'

// =============================================================================
// ENTITY TYPES
// =============================================================================

/**
 * Broadcast Target - Defines where broadcasts can be sent
 */
export interface BroadcastTarget {
	id: string
	name: string
	description: string | null
	type: TargetType
	groupId: string
	config: Record<string, unknown> // { guildId: string, channelId: string } for Discord
	createdBy: string
	createdAt: string
	updatedAt: string
}

/**
 * Broadcast Template - Reusable message templates
 */
export interface BroadcastTemplate {
	id: string
	name: string
	description: string | null
	targetType: string
	groupId: string
	fieldSchema: TemplateFieldSchema[]
	messageTemplate: string
	createdBy: string
	createdAt: string
	updatedAt: string
}

/**
 * Template field schema definition
 */
export interface TemplateFieldSchema {
	name: string
	label: string
	type: 'text' | 'textarea'
	required?: boolean
	placeholder?: string
}

/**
 * Broadcast - Individual broadcast instance
 */
export interface Broadcast {
	id: string
	templateId: string | null
	targetId: string
	title: string
	content: Record<string, unknown>
	status: BroadcastStatus
	scheduledFor: string | null
	sentAt: string | null
	errorMessage: string | null
	groupId: string
	createdBy: string
	createdByCharacterName: string
	createdAt: string
	updatedAt: string
}

/**
 * Broadcast with related entities
 */
export interface BroadcastWithDetails extends Broadcast {
	template: BroadcastTemplate | null
	target: BroadcastTarget
	deliveries: BroadcastDelivery[]
}

/**
 * Broadcast Delivery - Tracks delivery status per target
 */
export interface BroadcastDelivery {
	id: string
	broadcastId: string
	targetId: string
	status: DeliveryStatus
	discordMessageId: string | null
	errorMessage: string | null
	sentAt: string | null
	createdAt: string
}

// =============================================================================
// REQUEST TYPES
// =============================================================================

/**
 * Create broadcast target request
 */
export interface CreateBroadcastTargetRequest {
	name: string
	description?: string
	type: TargetType
	groupId: string
	config: {
		guildId: string
		channelId: string
	}
}

/**
 * Update broadcast target request
 */
export interface UpdateBroadcastTargetRequest {
	name?: string
	description?: string
	config?: {
		guildId?: string
		channelId?: string
	}
}

/**
 * Create broadcast template request
 */
export interface CreateBroadcastTemplateRequest {
	name: string
	description?: string
	targetType: string
	groupId: string
	fieldSchema: TemplateFieldSchema[]
	messageTemplate: string
}

/**
 * Update broadcast template request
 */
export interface UpdateBroadcastTemplateRequest {
	name?: string
	description?: string
	fieldSchema?: TemplateFieldSchema[]
	messageTemplate?: string
}

/**
 * Create broadcast request
 */
export interface CreateBroadcastRequest {
	templateId?: string
	targetId: string
	title: string
	content: Record<string, unknown>
	groupId: string
	createdByCharacterName: string
	scheduledFor?: string
}

/**
 * Send broadcast result
 */
export interface SendBroadcastResult {
	success: boolean
	broadcast: Broadcast
	delivery: BroadcastDelivery
}

// =============================================================================
// RPC INTERFACE
// =============================================================================

/**
 * Public RPC interface for Broadcasts Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Broadcasts } from '@repo/broadcasts'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Broadcasts>(env.BROADCASTS, 'default')
 * const targets = await stub.listTargets('user-id-123')
 * ```
 */
export interface Broadcasts {
	// =========================================================================
	// BROADCAST TARGETS
	// =========================================================================

	/**
	 * List all broadcast targets, optionally filtered by group
	 * @param userId - User ID making the request (for audit)
	 * @param groupId - Optional group ID to filter by
	 * @returns Array of broadcast targets
	 */
	listTargets(userId: string, groupId?: string): Promise<BroadcastTarget[]>

	/**
	 * Get a single broadcast target by ID
	 * @param targetId - Target ID
	 * @param userId - User ID making the request
	 * @returns Target or null if not found
	 */
	getTarget(targetId: string, userId: string): Promise<BroadcastTarget | null>

	/**
	 * Create a new broadcast target
	 * @param data - Target creation data
	 * @param userId - User ID creating the target
	 * @returns Created target
	 */
	createTarget(data: CreateBroadcastTargetRequest, userId: string): Promise<BroadcastTarget>

	/**
	 * Update a broadcast target
	 * @param targetId - Target ID to update
	 * @param data - Update data
	 * @param userId - User ID making the update
	 * @returns Updated target
	 */
	updateTarget(
		targetId: string,
		data: UpdateBroadcastTargetRequest,
		userId: string
	): Promise<BroadcastTarget>

	/**
	 * Delete a broadcast target
	 * @param targetId - Target ID to delete
	 * @param userId - User ID making the delete
	 */
	deleteTarget(targetId: string, userId: string): Promise<void>

	// =========================================================================
	// BROADCAST TEMPLATES
	// =========================================================================

	/**
	 * List broadcast templates with optional filters
	 * @param userId - User ID making the request
	 * @param filters - Optional filters (targetType, groupId)
	 * @returns Array of templates
	 */
	listTemplates(
		userId: string,
		filters?: { targetType?: string; groupId?: string }
	): Promise<BroadcastTemplate[]>

	/**
	 * Get a single template by ID
	 * @param templateId - Template ID
	 * @param userId - User ID making the request
	 * @returns Template or null if not found
	 */
	getTemplate(templateId: string, userId: string): Promise<BroadcastTemplate | null>

	/**
	 * Create a new broadcast template
	 * @param data - Template creation data
	 * @param userId - User ID creating the template
	 * @returns Created template
	 */
	createTemplate(data: CreateBroadcastTemplateRequest, userId: string): Promise<BroadcastTemplate>

	/**
	 * Update a broadcast template
	 * @param templateId - Template ID to update
	 * @param data - Update data
	 * @param userId - User ID making the update
	 * @returns Updated template
	 */
	updateTemplate(
		templateId: string,
		data: UpdateBroadcastTemplateRequest,
		userId: string
	): Promise<BroadcastTemplate>

	/**
	 * Delete a broadcast template
	 * @param templateId - Template ID to delete
	 * @param userId - User ID making the delete
	 */
	deleteTemplate(templateId: string, userId: string): Promise<void>

	// =========================================================================
	// BROADCASTS
	// =========================================================================

	/**
	 * List broadcasts with optional filters
	 * @param userId - User ID making the request
	 * @param filters - Optional filters (groupId, status)
	 * @returns Array of broadcasts
	 */
	listBroadcasts(
		userId: string,
		filters?: { groupId?: string; status?: BroadcastStatus }
	): Promise<Broadcast[]>

	/**
	 * Get a single broadcast with full details
	 * @param broadcastId - Broadcast ID
	 * @param userId - User ID making the request
	 * @returns Broadcast with details or null if not found
	 */
	getBroadcast(broadcastId: string, userId: string): Promise<BroadcastWithDetails | null>

	/**
	 * Create a new broadcast
	 * @param data - Broadcast creation data
	 * @param userId - User ID creating the broadcast
	 * @returns Created broadcast
	 */
	createBroadcast(data: CreateBroadcastRequest, userId: string): Promise<Broadcast>

	/**
	 * Send a broadcast immediately
	 * @param broadcastId - Broadcast ID to send
	 * @param userId - User ID sending the broadcast
	 * @returns Send result with delivery status
	 */
	sendBroadcast(broadcastId: string, userId: string): Promise<SendBroadcastResult>

	/**
	 * Delete a broadcast
	 * @param broadcastId - Broadcast ID to delete
	 * @param userId - User ID making the delete
	 */
	deleteBroadcast(broadcastId: string, userId: string): Promise<void>

	/**
	 * Get deliveries for a broadcast
	 * @param broadcastId - Broadcast ID
	 * @param userId - User ID making the request
	 * @returns Array of deliveries
	 */
	getDeliveries(broadcastId: string, userId: string): Promise<BroadcastDelivery[]>
}
