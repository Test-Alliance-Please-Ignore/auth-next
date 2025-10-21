import { getStub } from '@repo/do-utils'
import type { Notifications } from '@repo/notifications'

import type { Env } from '../context'

/**
 * Helper service for sending notifications from Groups DO
 */
export class NotificationService {
	private notificationsStub: Notifications

	constructor(env: Env, userId: string) {
		// Get the notifications DO stub for this user
		this.notificationsStub = getStub<Notifications>(env.NOTIFICATIONS, userId)
	}

	/**
	 * Send group invitation received notification
	 */
	async sendInvitationReceived(params: {
		invitationId: string
		groupId: string
		groupName: string
		categoryId: string
		categoryName: string
		inviterId: string
		inviterName: string
	}): Promise<void> {
		try {
			await this.notificationsStub.publishNotification(params.inviterId, {
				type: 'group.invitation.received',
				requiresAck: true,
				data: params,
			})
		} catch (error) {
			console.error('Failed to send invitation received notification:', error)
		}
	}

	/**
	 * Send group invitation accepted notification to admins
	 */
	async sendInvitationAccepted(
		adminUserIds: string[],
		params: {
			invitationId: string
			groupId: string
			groupName: string
			userId: string
			userName: string
		}
	): Promise<void> {
		try {
			// Send to all group admins
			for (const adminId of adminUserIds) {
				const stub = getStub<Notifications>(this.notificationsStub as unknown as DurableObjectNamespace, adminId)
				await stub.publishNotification(adminId, {
					type: 'group.invitation.accepted',
					requiresAck: false,
					data: params,
				})
			}
		} catch (error) {
			console.error('Failed to send invitation accepted notification:', error)
		}
	}

	/**
	 * Send group member joined notification to admins
	 */
	async sendMemberJoined(
		adminUserIds: string[],
		params: {
			groupId: string
			groupName: string
			userId: string
			userName: string
			joinMethod: 'open' | 'invitation' | 'invite_code' | 'approval'
		},
		env: Env
	): Promise<void> {
		try {
			for (const adminId of adminUserIds) {
				const stub = getStub<Notifications>(env.NOTIFICATIONS, adminId)
				await stub.publishNotification(adminId, {
					type: 'group.member.joined',
					requiresAck: false,
					data: params,
				})
			}
		} catch (error) {
			console.error('Failed to send member joined notification:', error)
		}
	}

	/**
	 * Send group admin granted notification
	 */
	async sendAdminGranted(
		newAdminUserId: string,
		params: {
			groupId: string
			groupName: string
			grantedById: string
			grantedByName: string
		},
		env: Env
	): Promise<void> {
		try {
			const stub = getStub<Notifications>(env.NOTIFICATIONS, newAdminUserId)
			await stub.publishNotification(newAdminUserId, {
				type: 'group.admin.granted',
				requiresAck: true,
				data: params,
			})
		} catch (error) {
			console.error('Failed to send admin granted notification:', error)
		}
	}

	/**
	 * Send join request created notification to admins
	 */
	async sendJoinRequestCreated(
		adminUserIds: string[],
		params: {
			requestId: string
			groupId: string
			groupName: string
			userId: string
			userName: string
			message?: string
		},
		env: Env
	): Promise<void> {
		try {
			for (const adminId of adminUserIds) {
				const stub = getStub<Notifications>(env.NOTIFICATIONS, adminId)
				await stub.publishNotification(adminId, {
					type: 'group.join_request.created',
					requiresAck: true,
					data: params,
				})
			}
		} catch (error) {
			console.error('Failed to send join request created notification:', error)
		}
	}

	/**
	 * Send join request approved notification
	 */
	async sendJoinRequestApproved(
		requesterUserId: string,
		params: {
			requestId: string
			groupId: string
			groupName: string
			approvedById: string
			approvedByName: string
		},
		env: Env
	): Promise<void> {
		try {
			const stub = getStub<Notifications>(env.NOTIFICATIONS, requesterUserId)
			await stub.publishNotification(requesterUserId, {
				type: 'group.join_request.approved',
				requiresAck: true,
				data: params,
			})
		} catch (error) {
			console.error('Failed to send join request approved notification:', error)
		}
	}

	/**
	 * Send member removed notification
	 */
	async sendMemberRemoved(
		removedUserId: string,
		params: {
			groupId: string
			groupName: string
			removedById: string
			removedByName: string
			reason?: string
		},
		env: Env
	): Promise<void> {
		try {
			const stub = getStub<Notifications>(env.NOTIFICATIONS, removedUserId)
			await stub.publishNotification(removedUserId, {
				type: 'group.member.removed',
				requiresAck: true,
				data: params,
			})
		} catch (error) {
			console.error('Failed to send member removed notification:', error)
		}
	}
}
