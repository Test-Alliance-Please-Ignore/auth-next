import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PasteViewPage from '@/routes/paste-view'

const { useAuthMock, useQueryMock, useMutationMock } = vi.hoisted(() => ({
	useAuthMock: vi.fn(),
	useQueryMock: vi.fn(),
	useMutationMock: vi.fn(),
}))

vi.mock('@/hooks/useAuth', () => ({
	useAuth: () => useAuthMock(),
}))

vi.mock('@tanstack/react-query', () => ({
	useQuery: (...args: unknown[]) => useQueryMock(...args),
	useMutation: (...args: unknown[]) => useMutationMock(...args),
}))

describe('PasteViewPage public error state', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useAuthMock.mockReturnValue({ isAuthenticated: false })
		useQueryMock.mockReturnValue({
			isLoading: false,
			isError: true,
			data: undefined,
			refetch: vi.fn(),
		})
		useMutationMock.mockReturnValue({
			data: undefined,
			isPending: false,
			mutate: vi.fn(),
		})
	})

	it('renders generic 404 content without retry button', () => {
		const html = renderToStaticMarkup(
			<MemoryRouter initialEntries={['/paste/Abc123']}>
				<Routes>
					<Route path="/paste/:id" element={<PasteViewPage />} />
				</Routes>
			</MemoryRouter>
		)

		expect(html).toContain('404 Not Found')
		expect(html).toContain('The requested paste was not found.')
		expect(html).not.toContain('Retry')
		expect(html).not.toContain('Paste Abc123')
	})
})

