// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SidebarNav } from '@/components/sidebar-nav'

import type { PropsWithChildren } from 'react'

const permissionState = vi.hoisted(() => ({ urns: [] as string[] }))

vi.mock('@/hooks/useUserPermissions', () => ({
	useUserPermissions: () => ({
		permissions: permissionState.urns.map((urn) => ({ urn })),
		hasAnyPermission: (...urns: string[]) =>
			permissionState.urns.some((permission) => urns.includes(permission)),
		isAdmin: false,
		isLoading: false,
	}),
}))

vi.mock('@/hooks/useAuth', () => ({
	useAuth: () => ({
		user: {
			id: '11111111-1111-4111-8111-111111111111',
			is_admin: false,
			roles: [],
			characters: [],
			mainCharacterId: null,
		},
	}),
	useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/features/corporations', () => ({
	useCorporationAccess: () => ({ data: undefined }),
	useHasCorporationAccess: () => ({ data: undefined }),
}))
vi.mock('@/features/hr', () => ({ useHrAccessibleCorporations: () => ({ data: [] }) }))
vi.mock('@/features/moon-scan/permissions', () => ({
	useMoonScanPermissions: () => ({
		canAccessMoonScan: false,
		canView: false,
		canSubmit: false,
		canLeaderboard: false,
		canValidate: false,
		canAdmin: false,
	}),
}))
vi.mock('@/features/mumble/feature', () => ({
	useMumbleFeatureEnabled: () => ({ isEnabled: false }),
}))
vi.mock('@/features/srp/hooks', () => ({
	useSrpPaymentMismatchAlerts: () => ({ data: { total: 0 } }),
}))
vi.mock('@/features/srp/state/review-queue-snapshot-store', () => ({
	useReviewQueueStatusCount: () => undefined,
}))
vi.mock('@/features/structures/hooks', () => ({
	useStructureAccess: () => ({ data: undefined }),
}))
vi.mock('@/hooks/corporation-tax', () => ({ useTaxAlerts: () => ({ data: [] }) }))
vi.mock('@/hooks/useGroups', () => ({ usePendingInvitations: () => ({ data: [] }) }))
vi.mock('@/lib/api', () => ({
	api: {
		getRequestCountByStatus: vi.fn().mockResolvedValue({ total: 0 }),
		getSidebarExternalLinks: vi.fn().mockResolvedValue([]),
	},
}))

function TestProviders({ children }: PropsWithChildren) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	return (
		<QueryClientProvider client={queryClient}>
			<MemoryRouter>{children}</MemoryRouter>
		</QueryClientProvider>
	)
}

beforeEach(() => {
	permissionState.urns = []
})

afterEach(() => {
	cleanup()
})

describe('Timerboard sidebar navigation', () => {
	it('renders the Timerboard link when the user has a Timerboard permission', () => {
		permissionState.urns = ['urn:timerboard:view']

		render(<SidebarNav />, { wrapper: TestProviders })

		const link = screen.getByRole('link', { name: 'Timerboard' })
		expect(link.getAttribute('href')).toBe('/timerboard')
	})

	it('does not render the Timerboard link without a Timerboard permission', () => {
		render(<SidebarNav />, { wrapper: TestProviders })

		expect(screen.queryByRole('link', { name: 'Timerboard' })).toBeNull()
	})
})
