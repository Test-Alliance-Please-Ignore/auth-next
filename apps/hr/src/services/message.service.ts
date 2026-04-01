import { asc, eq } from '@repo/db-utils'

import { applicationActivityLog, applicationMessages, applications } from '../db/schema'

import type { ApplicationMessage } from '@repo/hr'
import type { ServiceContext } from './context'

/**
 * Message Service
 *
 * Handles all business logic for application messages between HR reviewers and applicants.
 */
export class MessageService {
	constructor(private ctx: ServiceContext) { }

	/**
	 * Send a message from HR reviewer to applicant or vice versa
	 */
	async sendMessage(
		applicationId: string,
		senderId: string,
		recipientId: string | null,
		message: string,
		characterId: string,
		characterName: string,
		isSenderApplicant: boolean,
		senderHrCorporations: string[] = [],
		recipientHrCorporations: string[] = []
	): Promise<ApplicationMessage> {
		// Get the application to validate
		const application = await this.ctx.db.query.applications.findFirst({
			where: eq(applications.id, applicationId),
		})

		if (!application) {
			throw new Error('Application not found')
		}

		// Validate application is in "open" status (pending or under_review)
		if (!['pending', 'under_review'].includes(application.status)) {
			throw new Error('Messages can only be sent for applications that are pending or under review')
		}

		// Resolve the effective recipientId for storage
		// Applicants message HR as a group — use senderId as placeholder if no specific recipient
		const effectiveRecipientId = recipientId ?? senderId

		// Validate sender authorization
		if (isSenderApplicant) {
			// Applicant sending: must own the application
			if (application.userId !== senderId) {
				throw new Error('You can only send messages for your own applications')
			}
			// If a specific recipient was provided, validate they have HR access
			if (recipientId && !recipientHrCorporations.includes(application.corporationId)) {
				throw new Error('Invalid recipient: recipient must have HR access to this application')
			}
		} else {
			// HR sending: must have HR role for the application's corporation
			if (!senderHrCorporations.includes(application.corporationId)) {
				throw new Error('You do not have HR access to this application')
			}
			// Recipient must be the applicant
			if (application.userId !== recipientId) {
				throw new Error('Invalid recipient: recipient must be the applicant')
			}
		}

		// Validate message is not empty
		if (!message || message.trim().length === 0) {
			throw new Error('Message cannot be empty')
		}

		// Create the message
		const [messageRecord] = await this.ctx.db
			.insert(applicationMessages)
			.values({
				applicationId,
				senderId,
				senderCharacterId: characterId,
				senderCharacterName: characterName,
				recipientId: effectiveRecipientId,
				message: message.trim(),
			})
			.returning()

		if (!messageRecord) {
			throw new Error('Failed to create message')
		}

		// Log the activity
		await this.ctx.db.insert(applicationActivityLog).values({
			applicationId,
			userId: senderId,
			characterId,
			action: 'message_sent',
			previousValue: null,
			newValue: null,
			metadata: { messageId: messageRecord.id, senderId, recipientId: effectiveRecipientId },
		})

		return this.mapToApplicationMessage(messageRecord)
	}

	/**
	 * List all messages for an application
	 */
	async listMessages(
		applicationId: string,
		userId: string,
		isAdmin: boolean,
		userHrCorporations: string[] = []
	): Promise<ApplicationMessage[]> {
		// Get the application to validate authorization
		const application = await this.ctx.db.query.applications.findFirst({
			where: eq(applications.id, applicationId),
		})

		if (!application) {
			throw new Error('Application not found')
		}

		// Check authorization: owner or HR with access to corporation
		const isOwner = application.userId === userId
		const hasHrAccess = userHrCorporations.includes(application.corporationId)

		if (!isOwner && !hasHrAccess && !isAdmin) {
			throw new Error('You do not have permission to view messages for this application')
		}

		// Get all messages for this application
		const messages = await this.ctx.db.query.applicationMessages.findMany({
			where: eq(applicationMessages.applicationId, applicationId),
			orderBy: [asc(applicationMessages.createdAt)],
		})

		return messages.map((msg) => this.mapToApplicationMessage(msg))
	}

	/**
	 * Get count of messages for an application (for UI badges)
	 */
	async getMessageCount(
		applicationId: string,
		userId: string,
		isAdmin: boolean,
		userHrCorporations: string[] = []
	): Promise<number> {
		// Get the application to validate authorization
		const application = await this.ctx.db.query.applications.findFirst({
			where: eq(applications.id, applicationId),
		})

		if (!application) {
			throw new Error('Application not found')
		}

		// Check authorization: owner or HR with access to corporation
		const isOwner = application.userId === userId
		const hasHrAccess = userHrCorporations.includes(application.corporationId)

		if (!isOwner && !hasHrAccess && !isAdmin) {
			throw new Error('You do not have permission to view message count for this application')
		}

		// Count messages for this application
		const messages = await this.ctx.db.query.applicationMessages.findMany({
			where: eq(applicationMessages.applicationId, applicationId),
		})

		return messages.length
	}

	/**
	 * Map database record to ApplicationMessage DTO
	 */
	private mapToApplicationMessage(
		msg: typeof applicationMessages.$inferSelect
	): ApplicationMessage {
		return {
			id: msg.id,
			applicationId: msg.applicationId,
			senderId: msg.senderId,
			senderCharacterId: msg.senderCharacterId,
			senderCharacterName: msg.senderCharacterName,
			recipientId: msg.recipientId,
			message: msg.message,
			createdAt: msg.createdAt,
		}
	}
}

