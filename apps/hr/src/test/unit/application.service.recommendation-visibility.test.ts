import { describe, expect, it, vi } from 'vitest'

import { ApplicationService } from '../../services/application.service'

import type {
	applicationActivityLog,
	applicationRecommendations,
	applications,
} from '../../db/schema'
import type { ServiceContext } from '../../services/context'

const date = new Date('2026-09-13T10:00:00Z')
const application: typeof applications.$inferSelect = {
	id: 'application',
	corporationId: 'corporation',
	userId: 'applicant',
	characterId: 'pilot',
	characterName: 'Applicant',
	applicationText: 'Original application',
	status: 'pending',
	reviewedBy: null,
	reviewedAt: null,
	reviewNotes: null,
	lastStaffInteractionAt: null,
	createdAt: date,
	updatedAt: date,
}
const recommendations: Array<typeof applicationRecommendations.$inferSelect> = [
	{ id: 'public', userId: 'public-author', isPublic: true },
	{ id: 'private', userId: 'private-author', isPublic: false },
	{ id: 'own', userId: 'applicant', isPublic: false },
].map((rec) => ({
	...rec,
	applicationId: application.id,
	characterId: rec.userId,
	characterName: rec.userId,
	recommendationText: `${rec.id} recommendation text`,
	sentiment: 'positive',
	createdAt: date,
	updatedAt: date,
}))
function event(
	id: string,
	action: string,
	recommendationId?: unknown,
	userId = 'private-author'
): typeof applicationActivityLog.$inferSelect {
	return {
		id,
		action,
		userId,
		applicationId: application.id,
		characterId: userId,
		characterName: userId,
		previousValue: null,
		newValue: 'positive',
		metadata: recommendationId === undefined ? null : { recommendationId },
		timestamp: date,
	}
}
const history = [
	event('submitted', 'submitted', undefined, 'applicant'),
	event('public-added', 'recommendation_added', 'public', 'public-author'),
	event('private-added', 'recommendation_added', 'private'),
	event('private-updated', 'recommendation_updated', 'private'),
	event('deleted', 'recommendation_deleted', 'removed-recommendation'),
	event('legacy', 'recommendation_added'),
	event('malformed', 'recommendation_added', 123),
	event('own-added', 'recommendation_added', 'own', 'applicant'),
	event('own-deleted', 'recommendation_deleted', 'deleted-own', 'applicant'),
	event('status', 'status_changed', undefined, 'staff'),
]
function setup() {
	const db = {
		query: {
			applications: {
				findFirst: vi.fn().mockResolvedValue(application),
				findMany: vi.fn().mockResolvedValue([application]),
			},
			applicationRecommendations: { findMany: vi.fn().mockResolvedValue(recommendations) },
			applicationAlts: { findMany: vi.fn().mockResolvedValue([{ characterId: 'alt' }]) },
			applicationActivityLog: { findMany: vi.fn().mockResolvedValue(history) },
		},
	}
	return { db, service: new ApplicationService({ db, env: {} } as unknown as ServiceContext) }
}
describe('application recommendation visibility', () => {
	it.each([[], ['other-corporation']])(
		'limits an applicant with HR corporations %j to public and own recommendations',
		async (...corporations) => {
			const { service } = setup()
			const result = await service.getApplication(
				application.id,
				'applicant',
				false,
				false,
				corporations,
				true
			)
			expect(result.recommendations.map((rec) => rec.id)).toEqual(['public', 'own'])
			expect(result.recommendationCount).toBe(2)
			expect(result.activityLog?.map((entry) => entry.id)).toEqual([
				'submitted',
				'public-added',
				'own-added',
				'own-deleted',
				'status',
			])
			expect(JSON.stringify(result)).not.toContain('private-author')
			expect(JSON.stringify(result)).not.toContain('private recommendation text')
			expect(result.altCharacterIds).toEqual(['alt'])
			expect(result.applicationText).toBe(application.applicationText)
		}
	)
	it.each([
		{ role: 'HR', admin: false, auditor: false, corporations: ['corporation'] },
		{ role: 'admin', admin: true, auditor: false, corporations: [] },
		{ role: 'auditor', admin: false, auditor: true, corporations: [] },
	])(
		'preserves $role access to all recommendations and history',
		async ({ admin, auditor, corporations }) => {
			const { service } = setup()
			for (const userId of ['staff', 'applicant']) {
				const result = await service.getApplication(
					application.id,
					userId,
					admin,
					auditor,
					corporations,
					true
				)
				expect(result.recommendations).toEqual(recommendations)
				expect(result.recommendationCount).toBe(3)
				expect(result.activityLog?.map((entry) => entry.id)).toEqual(
					history.map((entry) => entry.id)
				)
			}
		}
	)
	it('does not fetch history unless requested and still filters recommendation bodies', async () => {
		const { service, db } = setup()
		const result = await service.getApplication(application.id, 'applicant', false, false)
		expect(result.recommendationCount).toBe(2)
		expect(result.activityLog).toBeUndefined()
		expect(db.query.applicationActivityLog.findMany).not.toHaveBeenCalled()
	})
	it('denies unrelated viewers before reading recommendations', async () => {
		const { service, db } = setup()
		await expect(
			service.getApplication(application.id, 'outsider', false, false, ['other-corporation'], true)
		).rejects.toThrow('permission')
		expect(db.query.applicationRecommendations.findMany).not.toHaveBeenCalled()
		expect(db.query.applicationActivityLog.findMany).not.toHaveBeenCalled()
	})
	it('returns no recommendation history when no recommendation is visible', async () => {
		const { service, db } = setup()
		db.query.applicationRecommendations.findMany.mockResolvedValue([recommendations[1]])
		db.query.applicationActivityLog.findMany.mockResolvedValue(
			history.filter((entry) => entry.userId !== 'applicant')
		)
		const result = await service.getApplication(application.id, 'applicant', false, false, [], true)
		expect(result.recommendations).toEqual([])
		expect(result.recommendationCount).toBe(0)
		expect(result.activityLog?.map((entry) => entry.id)).toEqual(['status'])
	})
})
