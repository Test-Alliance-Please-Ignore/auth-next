/**
 * @repo/notifications
 *
 * Shared types and interfaces for the Notifications Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Notification event types for different system events
 */
export type NotificationEventType =
	// Group invitation events
	| 'group.invitation.received'
	| 'group.invitation.accepted'
	| 'group.invitation.declined'
	// Group membership events
	| 'group.member.joined'
	| 'group.member.left'
	| 'group.member.removed'
	// Group admin events
	| 'group.admin.granted'
	| 'group.admin.revoked'
	// Group join request events
	| 'group.join_request.created'
	| 'group.join_request.approved'
	| 'group.join_request.rejected'
	// Group events
	| 'group.created'
	| 'group.updated'
	| 'group.deleted'

/**
 * Base notification payload structure
 */
export interface NotificationPayload {
	id: string
	type: NotificationEventType
	timestamp: number
	requiresAck: boolean
	data: Record<string, unknown>
}

/**
 * Group invitation received notification
 */
export interface GroupInvitationReceivedNotification extends NotificationPayload {
	type: 'group.invitation.received'
	data: {
		invitationId: string
		groupId: string
		groupName: string
		categoryId: string
		categoryName: string
		inviterId: string
		inviterName: string
	}
}

/**
 * Group invitation accepted notification (sent to group admins)
 */
export interface GroupInvitationAcceptedNotification extends NotificationPayload {
	type: 'group.invitation.accepted'
	data: {
		invitationId: string
		groupId: string
		groupName: string
		userId: string
		userName: string
	}
}

/**
 * Group member joined notification (sent to group admins)
 */
export interface GroupMemberJoinedNotification extends NotificationPayload {
	type: 'group.member.joined'
	data: {
		groupId: string
		groupName: string
		userId: string
		userName: string
		joinMethod: 'open' | 'invitation' | 'invite_code' | 'approval'
	}
}

/**
 * Group member removed notification (sent to removed user)
 */
export interface GroupMemberRemovedNotification extends NotificationPayload {
	type: 'group.member.removed'
	data: {
		groupId: string
		groupName: string
		removedById: string
		removedByName: string
		reason?: string
	}
}

/**
 * Group admin granted notification (sent to new admin)
 */
export interface GroupAdminGrantedNotification extends NotificationPayload {
	type: 'group.admin.granted'
	data: {
		groupId: string
		groupName: string
		grantedById: string
		grantedByName: string
	}
}

/**
 * Group admin revoked notification (sent to former admin)
 */
export interface GroupAdminRevokedNotification extends NotificationPayload {
	type: 'group.admin.revoked'
	data: {
		groupId: string
		groupName: string
		revokedById: string
		revokedByName: string
	}
}

/**
 * Group join request created notification (sent to group admins)
 */
export interface GroupJoinRequestCreatedNotification extends NotificationPayload {
	type: 'group.join_request.created'
	data: {
		requestId: string
		groupId: string
		groupName: string
		userId: string
		userName: string
		message?: string
	}
}

/**
 * Group join request approved notification (sent to requester)
 */
export interface GroupJoinRequestApprovedNotification extends NotificationPayload {
	type: 'group.join_request.approved'
	data: {
		requestId: string
		groupId: string
		groupName: string
		approvedById: string
		approvedByName: string
	}
}

/**
 * Group join request rejected notification (sent to requester)
 */
export interface GroupJoinRequestRejectedNotification extends NotificationPayload {
	type: 'group.join_request.rejected'
	data: {
		requestId: string
		groupId: string
		groupName: string
		rejectedById: string
		rejectedByName: string
		reason?: string
	}
}

/**
 * Union type of all notification types
 */
export type Notification =
	| GroupInvitationReceivedNotification
	| GroupInvitationAcceptedNotification
	| GroupMemberJoinedNotification
	| GroupMemberRemovedNotification
	| GroupAdminGrantedNotification
	| GroupAdminRevokedNotification
	| GroupJoinRequestCreatedNotification
	| GroupJoinRequestApprovedNotification
	| GroupJoinRequestRejectedNotification

/**
 * Client-to-server WebSocket messages
 */
export type ClientMessage =
	| {
			type: 'ping'
	  }
	| {
			type: 'ack'
			notificationId: string
	  }

/**
 * Server-to-client WebSocket messages
 */
export type ServerMessage =
	| Notification
	| {
			type: 'pong'
	  }
	| {
			type: 'error'
			message: string
	  }

/**
 * Connection metadata stored for each WebSocket
 */
export interface ConnectionMetadata {
	connectedAt: number
	lastPingAt?: number
	userAgent?: string
}

/**
 * RPC interface for the Notifications Durable Object
 */
export interface Notifications {
	/**
	 * Upgrade HTTP request to WebSocket connection
	 */
	connect(request: Request, userId: string): Promise<Response>

	/**
	 * Publish a notification to a specific user
	 */
	publishNotification(userId: string, notification: Omit<Notification, 'id' | 'timestamp'>): Promise<void>

	/**
	 * Broadcast a notification to multiple users
	 */
	broadcastNotification(userIds: string[], notification: Omit<Notification, 'id' | 'timestamp'>): Promise<void>

	/**
	 * Get connection count for a user (useful for testing/monitoring)
	 */
	getConnectionCount(userId: string): Promise<number>
}
