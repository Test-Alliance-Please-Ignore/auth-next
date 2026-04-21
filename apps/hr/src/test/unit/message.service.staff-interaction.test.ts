import { describe, expect, it, vi } from 'vitest'

import { MessageService } from '../../services/message.service'

import type { ServiceContext } from '../../services/context'

function makeService(db: any) {
	const ctx = { db, env: {} } as unknown as ServiceContext
	return new MessageService(ctx)
}

function makeApplication() {
	return {
		id: 'app-1',
		userId: 'applicant-1',
		characterId: 'char-1',
		characterName: 'Applicant',
		corporationId: 'corp-1',
		applicationText: 'apply',
		status: 'pending',
		reviewedBy: null,
		reviewedAt: null,
		reviewNotes: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		lastStaffInteractionAt: null,
	}
}

describe('MessageService.sendMessage staff interaction touch behavior', () => {
	it('touches application interaction timestamp when HR sends message', async () => {
		const messageRow = {
			id: 'msg-1',
			applicationId: 'app-1',
			senderId: 'reviewer-1',
			senderCharacterId: 'char-2',
			recipientId: 'applicant-1',
			message: 'Hello',
			createdAt: new Date(),
		}

		const messageInsertValues = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([messageRow]),
		})
		const activityInsertValues = vi.fn().mockResolvedValue(undefined)
		const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		let insertCallCount = 0

		const db = {
			query: {
				applications: {
					findFirst: vi.fn().mockResolvedValue(makeApplication()),
				},
				applicationMessages: {
					findMany: vi.fn(),
				},
			},
			insert: vi.fn((table: unknown) => {
				// First insert call: application_messages
				// Second insert call: application_activity_log
				insertCallCount += 1
				if (insertCallCount === 1) return { values: messageInsertValues }
				return { values: activityInsertValues }
			}),
			update: vi.fn().mockReturnValue({ set: updateSet }),
		}

		const service = makeService(db)
		await service.sendMessage(
			'app-1',
			'reviewer-1',
			'applicant-1',
			'Hello',
			'char-2',
			false
		)

		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				lastStaffInteractionAt: expect.any(Date),
				updatedAt: expect.any(Date),
			})
		)
	})

	it('does not touch application interaction timestamp when applicant sends message', async () => {
		const messageRow = {
			id: 'msg-1',
			applicationId: 'app-1',
			senderId: 'applicant-1',
			senderCharacterId: 'char-1',
			recipientId: 'applicant-1',
			message: 'Ping',
			createdAt: new Date(),
		}
		const messageInsertValues = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([messageRow]),
		})
		const activityInsertValues = vi.fn().mockResolvedValue(undefined)
		const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		let insertCallCount = 0

		const db = {
			query: {
				applications: {
					findFirst: vi.fn().mockResolvedValue(makeApplication()),
				},
				applicationMessages: {
					findMany: vi.fn(),
				},
			},
			insert: vi.fn((table: unknown) => {
				insertCallCount += 1
				if (insertCallCount === 1) return { values: messageInsertValues }
				return { values: activityInsertValues }
			}),
			update: vi.fn().mockReturnValue({ set: updateSet }),
		}

		const service = makeService(db)
		await service.sendMessage(
			'app-1',
			'applicant-1',
			null,
			'Ping',
			'char-1',
			true
		)

		expect(updateSet).not.toHaveBeenCalled()
	})
})
