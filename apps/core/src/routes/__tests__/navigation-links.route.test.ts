import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import adminNavigationLinksRoutes from '../admin/navigation-links'
import navigationLinksRoutes from '../navigation-links'

const { createDbMock } = vi.hoisted(() => ({
	createDbMock: vi.fn(),
}))

vi.mock('../../db', () => ({
	createDb: (...args: unknown[]) => createDbMock(...args),
}))

vi.mock('../../middleware/session', () => ({
	requireAuth: () => async (_c: unknown, next: () => Promise<void>) => next(),
	requireAdmin: () => async (_c: unknown, next: () => Promise<void>) => next(),
	sessionMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

function createApp() {
	const app = new Hono<{ Bindings: any; Variables: { user?: { id: string; is_admin: boolean } } }>()
	app.route('/api/navigation', navigationLinksRoutes)
	app.route('/api/admin/navigation', adminNavigationLinksRoutes)
	return app
}

function makeLink(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: 'link-1',
		displayName: 'Wiki',
		url: 'https://wiki.pleaseignore.com/start',
		iconName: 'BookMarked',
		sortOrder: 100,
		isEnabled: true,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
		...overrides,
	}
}

describe('navigation links routes', () => {
	const findManyMock = vi.fn()
	const insertValuesMock = vi.fn()
	const updateSetMock = vi.fn()
	const deleteWhereMock = vi.fn()
	const returningMock = vi.fn()
	const deleteReturningMock = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		findManyMock.mockResolvedValue([makeLink()])
		insertValuesMock.mockReturnValue({ returning: returningMock })
		updateSetMock.mockReturnValue({ where: () => ({ returning: returningMock }) })
		deleteWhereMock.mockReturnValue({ returning: deleteReturningMock })
		returningMock.mockResolvedValue([makeLink({ id: 'link-2', displayName: 'Forums' })])
		deleteReturningMock.mockResolvedValue([{ id: 'link-1' }])
		createDbMock.mockReturnValue({
			query: {
				sidebarExternalLinks: {
					findMany: findManyMock,
				},
			},
			insert: vi.fn(() => ({ values: insertValuesMock })),
			update: vi.fn(() => ({ set: updateSetMock })),
			delete: vi.fn(() => ({ where: deleteWhereMock })),
		})
	})

	it('returns only enabled external links in public order', async () => {
		findManyMock.mockResolvedValueOnce([
			makeLink({ id: 'link-2', displayName: 'Forums', sortOrder: 200 }),
			makeLink({ id: 'link-1', displayName: 'Wiki', sortOrder: 100 }),
		])

		const app = createApp()
		const response = await app.request('/api/navigation/external-links', {}, {
			DATABASE_URL: 'postgresql://test',
		} as any)

		expect(response.status).toBe(200)
		expect(findManyMock).toHaveBeenCalled()
		expect(findManyMock.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				orderBy: expect.arrayContaining([expect.anything(), expect.anything(), expect.anything()]),
			})
		)
		const body = (await response.json()) as Array<{ displayName: string; iconName: string }>
		expect(body.map((row) => row.displayName)).toEqual(['Forums', 'Wiki'])
		expect(body.map((row) => row.iconName)).toEqual(['book-marked', 'book-marked'])
	})

	it('creates, updates, and deletes admin external links', async () => {
		const app = createApp()
		const createResponse = await app.request(
			'/api/admin/navigation/external-links',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					displayName: 'Forums',
					url: 'https://disc.pleaseignore.com/',
					iconName: 'MessageSquare',
					sortOrder: 300,
					isEnabled: true,
				}),
			},
			{
				DATABASE_URL: 'postgresql://test',
			} as any
		)
		expect(createResponse.status).toBe(201)
		expect(insertValuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				displayName: 'Forums',
				url: 'https://disc.pleaseignore.com/',
				iconName: 'message-square',
				sortOrder: 300,
				isEnabled: true,
			})
		)

		const updateResponse = await app.request(
			'/api/admin/navigation/external-links/link-1',
			{
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					displayName: 'Wiki Updated',
					url: 'https://wiki.pleaseignore.com/home',
					iconName: 'BookOpen',
					sortOrder: 50,
					isEnabled: false,
				}),
			},
			{
				DATABASE_URL: 'postgresql://test',
			} as any
		)
		expect(updateResponse.status).toBe(200)
		expect(updateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				displayName: 'Wiki Updated',
				url: 'https://wiki.pleaseignore.com/home',
				iconName: 'book-open',
				sortOrder: 50,
				isEnabled: false,
			})
		)

		const deleteResponse = await app.request(
			'/api/admin/navigation/external-links/link-1',
			{ method: 'DELETE' },
			{
				DATABASE_URL: 'postgresql://test',
			} as any
		)
		expect(deleteResponse.status).toBe(200)
		expect(deleteWhereMock).toHaveBeenCalled()
	})
})
