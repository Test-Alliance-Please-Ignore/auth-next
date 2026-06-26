import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TempopSection } from '@/features/mumble/components/tempop-section'

const { useCreateTempopMock, useDeleteTempopMock, useTempopsMock } = vi.hoisted(() => ({
	useCreateTempopMock: vi.fn(),
	useDeleteTempopMock: vi.fn(),
	useTempopsMock: vi.fn(),
}))

vi.mock('@/features/mumble/tempop-hooks', () => ({
	useCreateTempop: useCreateTempopMock,
	useDeleteTempop: useDeleteTempopMock,
	useTempops: useTempopsMock,
}))

describe('TempopSection', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useDeleteTempopMock.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
		})
		useTempopsMock.mockReturnValue({
			data: {
				items: [
					{
						id: 'tempop-1',
						shortCode: 'A1',
						creatorUserId: 'user-1',
						creatorName: 'Creator One',
						groupName: 'TempOp',
						ttlSeconds: 7200,
						status: 'active',
						guestCount: 1,
						createdAt: '2026-06-26T12:00:00.000Z',
						expiresAt: '2026-06-26T14:00:00.000Z',
						deletedAt: null,
						canDelete: true,
					},
				],
				creators: [{ id: 'user-1', name: 'Creator One' }],
				pagination: {
					page: 1,
					pageSize: 25,
					totalCount: 30,
					totalPages: 2,
					hasNextPage: true,
					hasPreviousPage: false,
				},
			},
			isLoading: false,
			error: null,
		})
	})

	it('renders the temp-op list in a shared table with top and bottom pagination controls', () => {
		const html = renderToStaticMarkup(
			<TempopSection canCreate={false} canManageAll={true} />
		)

		expect(html).toContain('<table')
		expect(html).toContain('Short Code')
		expect(html).toContain('Creator One')
		expect(html).toContain('Per page:')
		expect(html.match(/Per page:/g)).toHaveLength(2)
		expect(html).toContain('Delete')
		expect(html).not.toContain('No temp-ops match these filters.')
	})
})
