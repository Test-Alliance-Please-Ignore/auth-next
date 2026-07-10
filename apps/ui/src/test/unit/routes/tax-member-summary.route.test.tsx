import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TaxMemberSummaryPage from '@/routes/tax-member-summary'

const {
	useCorporationAccessMock,
	useEntityNamesMock,
	usePageTitleMock,
	useTaxCapabilitiesMock,
	useTaxCorporationsMock,
	useTaxSummaryReportMock,
} = vi.hoisted(() => ({
	useCorporationAccessMock: vi.fn(),
	useEntityNamesMock: vi.fn(),
	usePageTitleMock: vi.fn(),
	useTaxCapabilitiesMock: vi.fn(),
	useTaxCorporationsMock: vi.fn(),
	useTaxSummaryReportMock: vi.fn(),
}))

vi.mock('@/features/corporations', () => ({
	useCorporationAccess: (...args: unknown[]) => useCorporationAccessMock(...args),
}))

vi.mock('@/hooks/useEntityNames', () => ({
	useEntityNames: (...args: unknown[]) => useEntityNamesMock(...args),
}))

vi.mock('@/hooks/usePageTitle', () => ({
	usePageTitle: (...args: unknown[]) => usePageTitleMock(...args),
}))

vi.mock('@/hooks/corporation-tax', () => ({
	useTaxCapabilities: (...args: unknown[]) => useTaxCapabilitiesMock(...args),
	useTaxCorporations: (...args: unknown[]) => useTaxCorporationsMock(...args),
	useTaxSummaryReport: (...args: unknown[]) => useTaxSummaryReportMock(...args),
}))

vi.mock('@/components/tax-corporation-scope-selector', () => ({
	TaxCorporationScopeSelector: () => <div data-testid="scope-selector">scope-selector</div>,
}))

vi.mock('@/components/tax-member-summary/member-summary-grid-card', () => ({
	MemberSummaryGridCard: (props: {
		effectiveCorporationId?: string
		isScopeLoading?: boolean
		canViewSummary?: boolean
	}) => (
		<div data-testid="member-summary-grid">
			{props.isScopeLoading
				? 'loading'
				: `${props.effectiveCorporationId ?? 'none'}:${props.canViewSummary ? 'enabled' : 'disabled'}`}
		</div>
	),
}))

vi.mock('@/components/ui/button', () => ({
	Button: (props: { children?: ReactNode }) => <button>{props.children}</button>,
}))

vi.mock('@/components/ui/card', () => ({
	Card: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	CardContent: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	CardDescription: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	CardHeader: (props: { children?: ReactNode }) => <div>{props.children}</div>,
	CardTitle: (props: { children?: ReactNode }) => <div>{props.children}</div>,
}))

vi.mock('@/components/ui/container', () => ({
	Container: (props: { children?: ReactNode }) => <div>{props.children}</div>,
}))

vi.mock('@/components/ui/date-range-input', () => ({
	DateRangeInput: () => <div data-testid="date-range-input">date-range-input</div>,
}))

vi.mock('@/components/ui/input', () => ({
	Input: (props: { value?: string }) => <input value={props.value ?? ''} readOnly />,
}))

vi.mock('@/components/ui/page-header', () => ({
	PageHeader: (props: { title?: string; description?: string }) => (
		<div>
			<div>{props.title}</div>
			<div>{props.description}</div>
		</div>
	),
}))

vi.mock('@/components/ui/section', () => ({
	Section: (props: { children?: ReactNode }) => <div>{props.children}</div>,
}))

describe('TaxMemberSummaryPage corporation scope gating', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('holds summary fetching until corporation scope resolution completes', () => {
		usePageTitleMock.mockReturnValue(undefined)
		useTaxCapabilitiesMock.mockImplementation((corporationId?: string) =>
			corporationId
				? {
						data: {
							corporationId,
							global: { canRead: false, canAudit: false, canManage: false },
							scoped: { canRead: false, canAudit: false, canManage: false },
						},
						isLoading: false,
					}
				: {
						data: {
							corporationId: null,
							global: { canRead: true, canAudit: false, canManage: false },
							scoped: { canRead: false, canAudit: false, canManage: false },
						},
						isLoading: false,
					}
		)
		useCorporationAccessMock.mockReturnValue({
			data: {
				hasAccess: true,
				corporations: [{ corporationId: 'corp-1', name: 'Alpha Corp' }],
			},
			isLoading: true,
		})
		useTaxCorporationsMock.mockReturnValue({
			data: [{ corporationId: 'corp-1', name: 'Alpha Corp' }],
			isLoading: true,
		})
		useEntityNamesMock.mockReturnValue({ data: {}, isLoading: false })
		useTaxSummaryReportMock.mockReturnValue({
			data: { taxPaid: '0' },
			isFetching: false,
			isLoading: false,
			refetch: vi.fn(),
		})

		const html = renderToStaticMarkup(<TaxMemberSummaryPage />)

		expect(html).toContain('Loading Corporation Scope')
		expect(html).toContain('Resolving accessible corporations before loading member summaries.')
		expect(html).toContain('loading')
		expect(html).not.toContain('Taxes Paid')

		expect(useTaxSummaryReportMock).toHaveBeenCalledTimes(1)
		expect(useTaxSummaryReportMock).toHaveBeenCalledWith(
			expect.objectContaining({
				corporationId: undefined,
				enabled: false,
			})
		)
	})

	it('keeps the member summary grid available for read-only access while hiding audit totals', () => {
		usePageTitleMock.mockReturnValue(undefined)
		useTaxCapabilitiesMock.mockImplementation((corporationId?: string) =>
			corporationId
				? {
						data: {
							corporationId,
							global: { canRead: true, canAudit: false, canManage: false },
							scoped: { canRead: true, canAudit: false, canManage: false },
						},
						isLoading: false,
					}
				: {
						data: {
							corporationId: null,
							global: { canRead: true, canAudit: false, canManage: false },
							scoped: { canRead: false, canAudit: false, canManage: false },
						},
						isLoading: false,
					}
		)
		useCorporationAccessMock.mockReturnValue({
			data: {
				hasAccess: true,
				corporations: [{ corporationId: 'corp-1', name: 'Alpha Corp' }],
			},
			isLoading: false,
		})
		useTaxCorporationsMock.mockReturnValue({
			data: [{ corporationId: 'corp-1', name: 'Alpha Corp' }],
			isLoading: false,
		})
		useEntityNamesMock.mockReturnValue({ data: {}, isLoading: false })
		useTaxSummaryReportMock.mockReturnValue({
			data: { taxPaid: '0' },
			isFetching: false,
			isLoading: false,
			refetch: vi.fn(),
		})

		const html = renderToStaticMarkup(<TaxMemberSummaryPage />)

		expect(html).toContain('corp-1:enabled')
		expect(html).not.toContain('Taxes Paid')
		expect(useTaxSummaryReportMock).toHaveBeenCalledWith(
			expect.objectContaining({
				corporationId: 'corp-1',
				enabled: false,
			})
		)
	})
})
