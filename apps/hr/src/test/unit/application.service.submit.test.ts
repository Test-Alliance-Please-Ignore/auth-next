import { describe, expect, it, vi } from 'vitest'

import { ApplicationService } from '../../services/application.service'

import type { ServiceContext } from '../../services/context'

function makeApplication(overrides: Record<string, unknown> = {}) {
	return {
		id: 'app-1',
		userId: 'user-1',
		characterId: 'char-1001',
		characterName: 'Main Pilot',
		corporationId: 'corp-1',
		applicationText: 'hello',
		status: 'pending',
		reviewedBy: null,
		reviewedAt: null,
		reviewNotes: null,
		createdAt: new Date('2026-06-11T12:00:00.000Z'),
		updatedAt: new Date('2026-06-11T12:00:00.000Z'),
		...overrides,
	}
}

function makeService() {
	const application = makeApplication()
	const queryApplicationsFindMany = vi.fn().mockResolvedValue([application])
	const insertApplicationValues = vi.fn().mockReturnValue({
		returning: vi.fn().mockResolvedValue([application]),
	})
	const insertAltsValues = vi.fn().mockResolvedValue([])
	const insertActivityValues = vi.fn().mockResolvedValue([])

	const db = {
		query: {
			applications: {
				findMany: queryApplicationsFindMany,
				findFirst: vi.fn(),
			},
			applicationAlts: {
				findMany: vi.fn(),
			},
		},
		insert: vi
			.fn()
			.mockImplementationOnce(() => ({ values: insertApplicationValues }))
			.mockImplementationOnce(() => ({ values: insertAltsValues }))
			.mockImplementationOnce(() => ({ values: insertActivityValues })),
	} as unknown as ServiceContext['db']

	const service = new ApplicationService({ db, env: {} } as ServiceContext)
	return { service, db, application, queryApplicationsFindMany }
}

describe('ApplicationService.submitApplication', () => {
	it('returns isFirstApplication for the created application', async () => {
		const { service, queryApplicationsFindMany } = makeService()

		const result = await service.submitApplication(
			'user-1',
			'char-1001',
			'Main Pilot',
			'corp-1',
			'hello',
			['alt-2001']
		)

		expect(result.isFirstApplication).toBe(true)
		expect(result.altCharacterIds).toStrictEqual(['alt-2001'])
		expect(queryApplicationsFindMany).toHaveBeenCalledTimes(1)
	})
})
