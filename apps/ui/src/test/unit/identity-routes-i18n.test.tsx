import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CorporationsPage from '@/features/applications/routes/corporations'
import CorporationMembers from '@/features/corporations/routes/corporation-members'
import CorporationSettings from '@/features/corporations/routes/corporation-settings'
import { I18nProvider, setAppLocale } from '@/i18n'
import BrowseCorporations from '@/routes/browse-corporations'
import CharacterDetailPage from '@/routes/character-detail'
import CorporationDetail from '@/routes/corporation-detail'

import type * as ReactQuery from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type * as CorporationHooks from '@/features/corporations/hooks'
import type { api } from '@/lib/api'

type Overview = Awaited<ReturnType<typeof api.getCharacterDetail>>
const state = vi.hoisted(() => ({
	isAdmin: false,
	canAccess: true,
	userRole: 'Director' as string | null,
	pageTitle: '',
	error: null as Error | null,
	character: null as Overview | null,
	queries: [] as Array<{ queryKey: readonly unknown[]; enabled?: boolean }>,
	corporation: {
		corporationId: '987654321',
		name: 'Original Corp',
		ticker: 'ORIG',
		isMemberCorporation: true,
		isAltCorp: false,
		isSpecialPurpose: false,
		isRecruiting: true,
		shortDescription: 'Player-written short description',
		fullDescription: 'Player-written full description',
		currentRole: 'hr_viewer',
	},
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
	const actual = await importOriginal<typeof ReactQuery>()
	return {
		...actual,
		useQuery: (options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
			state.queries.push(options)
			const [family, , section] = options.queryKey
			if (family === 'character')
				return {
					data:
						section === 'overview'
							? state.character
							: { private: { wallet: { balance: '1234567.89' }, sensitiveDataIsLive: false } },
					isLoading: false,
					error: state.error,
				}
			if (family === 'corporations')
				return {
					data: state.error ? undefined : state.corporation,
					isLoading: false,
					error: state.error,
				}
			return { data: undefined, isLoading: false, error: null }
		},
	}
})
vi.mock('@/hooks/useAuth', () => ({
	useAuth: () => ({
		user: { id: 'account-1', is_admin: state.isAdmin },
		isAuthenticated: true,
		isLoading: false,
		permissions: [],
	}),
}))
vi.mock('@/hooks/useUserPermissions', () => ({
	useUserPermissions: () => ({ hasAnyPermission: () => false }),
}))
vi.mock('@/hooks/usePageTitle', () => ({
	usePageTitle: (title: string) => {
		state.pageTitle = title
	},
}))
vi.mock('@/hooks/useCharacters', () => ({
	useRefreshCharacter: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useCorporations', () => ({
	usePublicCorporations: () => ({ data: [state.corporation], isLoading: false }),
}))
vi.mock('@/features/applications', () => ({ SubmitApplicationDialog: () => null }))
vi.mock('@/features/applications/hooks', () => ({
	useCorporationApplicationCounts: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/features/hr', () => ({
	useHrAccessibleCorporations: () => ({
		data: [state.corporation],
		isLoading: false,
		error: state.error,
	}),
	useHrRoles: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/features/corporations/hooks', async (importOriginal) => {
	const actual = await importOriginal<typeof CorporationHooks>()
	return {
		...actual,
		useCorporationAccess: () => ({
			data: { corporations: [{ ...state.corporation, userRole: state.userRole }] },
		}),
		useCorporationCoverage: () => ({ data: { corporations: [] }, isLoading: false }),
		useCanAccessCorporation: () => ({
			canAccess: state.canAccess,
			isLoading: false,
			userRole: state.userRole,
			hrRole: null,
			corporation: state.corporation,
		}),
		useMyCorporation: () => ({ data: state.corporation, isLoading: false }),
		useCorporationManager: () => ({ invalidateMembers: vi.fn() }),
		useCorporationMembers: () => ({
			data: undefined,
			isLoading: false,
			isFetching: false,
			error: state.error,
		}),
	}
})

function render(
	path: string,
	url: string,
	children: ReactNode,
	navigationState?: Record<string, unknown>
) {
	return renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<I18nProvider>
				<MemoryRouter initialEntries={[{ pathname: url, state: navigationState }]}>
					<Routes>
						<Route path={path} element={children} />
					</Routes>
				</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}

describe('localized identity routes', () => {
	beforeEach(() => {
		state.isAdmin = false
		state.canAccess = true
		state.userRole = 'Director'
		state.error = null
		state.queries = []
		state.character = {
			characterId: '123456789',
			isOwner: true,
			viewedAsAdmin: false,
			viewedAsCeoOrDirector: false,
			viewedAsHrViewer: false,
			viewerRole: null,
			canViewPrivateData: true,
			public: {
				info: {
					name: 'Pilot Original',
					corporationId: '987654321',
					corporationName: 'Original Corp',
				},
				attributes: null,
				corporationHistory: [],
			},
			lastUpdated: null,
		}
	})
	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
	})

	it.each([
		['en', 'Join corporations', 'Ready to Apply?', 'Member corporation'],
		['de', 'Corporation beitreten', 'Bereit für deine Bewerbung?', 'Vollmitglied'],
		['ko', '코퍼레이션 가입', '지원할 준비가 되셨나요?', '멤버 코퍼레이션'],
	] as const)(
		'renders corporation browsing and recruitment details in %s with unchanged content',
		async (locale, heading, ready, memberLabel) => {
			await setAppLocale(locale, { persistLocal: false })
			const browse = render('/join', '/join', <BrowseCorporations />)
			expect(browse).toContain(heading)
			expect(browse).toContain(memberLabel)
			expect(browse).toContain('Original Corp')
			expect(browse).toContain('Player-written short description')
			expect(browse).toContain('/images/corporations/987654321/logo')
			const detail = render('/join/:corporationId', '/join/987654321', <CorporationDetail />)
			expect(detail).toContain(ready)
			expect(detail).toContain('Player-written full description')
			expect(detail).toContain('href="/join"')
			expect(state.pageTitle).toBe('Original Corp')
			expect(state.queries).toContainEqual(
				expect.objectContaining({ queryKey: ['corporations', '987654321'], enabled: true })
			)
		}
	)

	it('localizes corporation list controls and retains management links and role gating', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const html = render('/corporations', '/corporations', <CorporationsPage />)
		expect(html).toContain('코퍼레이션')
		expect(html).toContain('디렉터')
		expect(html).toContain('href="/corporations/987654321/members"')
		expect(html).not.toContain('href="/corporations/987654321/settings"')
		state.isAdmin = true
		expect(render('/corporations', '/corporations', <CorporationsPage />)).toContain(
			'href="/corporations/987654321/settings"'
		)
	})

	it('uses the approved German full-member corporation filter label', async () => {
		await setAppLocale('de', { persistLocal: false })
		state.isAdmin = true
		const html = render('/corporations', '/corporations', <CorporationsPage />)
		expect(html).toContain('id="corporation-type-filter"')
		expect(html).toContain('Vollmitglieder')
		expect(html).not.toContain('Mitglieds-Corporations')
		expect(html).toContain('Original Corp')
	})

	it('renders settings fields with translated accessible labels and denies unauthorized access', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const allowed = render(
			'/corporations/:corporationId/settings',
			'/corporations/987654321/settings',
			<CorporationSettings />
		)
		expect(allowed).toContain('모집 설정')
		expect(allowed).toContain('aria-label="짧은 소개"')
		expect(allowed).toContain('설정 저장')
		state.userRole = null
		state.queries = []
		const denied = render(
			'/corporations/:corporationId/settings',
			'/corporations/987654321/settings',
			<CorporationSettings />
		)
		expect(denied).toContain('이 코퍼레이션의 설정을 관리할 권한이 없습니다.')
		expect(denied).not.toContain('<textarea')
		expect(state.queries).toContainEqual(
			expect.objectContaining({ queryKey: ['corporations', '987654321'], enabled: false })
		)
	})

	it('preserves raw API errors on the member page and translates its fallback actions', async () => {
		await setAppLocale('de', { persistLocal: false })
		state.error = new Error('Raw API diagnostic')
		const html = render(
			'/corporations/:corporationId/members',
			'/corporations/987654321/members',
			<CorporationMembers />
		)
		expect(html).toContain('Raw API diagnostic')
		expect(html).toContain('Mitglieder konnten nicht geladen werden')
		expect(html).toContain('Erneut versuchen')
		state.error = null
		state.canAccess = false
		expect(
			render(
				'/corporations/:corporationId/members',
				'/corporations/987654321/members',
				<CorporationMembers />
			)
		).toContain('Zugriff verweigert')
	})

	it('uses semantic back-link labels after locale changes and retains character data queries', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const html = render(
			'/character/:characterId',
			'/character/123456789',
			<CharacterDetailPage />,
			{
				source: 'corporation-members',
				backTo: '/corporations/987654321/members',
				backLabel: 'Back to Members',
			}
		)
		expect(html).toContain('멤버 목록으로 돌아가기')
		expect(html).not.toContain('Back to Members')
		expect(html).toContain('href="/corporations/987654321/members"')
		expect(html).toContain('Pilot Original')
		expect(state.pageTitle).toBe('Pilot Original')
		for (const section of ['overview', 'private'])
			expect(state.queries).toContainEqual(
				expect.objectContaining({ queryKey: ['character', '123456789', section], enabled: true })
			)
	})

	it('does not reveal private character sections to a public-only viewer', async () => {
		await setAppLocale('de', { persistLocal: false })
		state.character!.isOwner = false
		const html = render('/character/:characterId', '/character/123456789', <CharacterDetailPage />)
		expect(html).not.toContain('1.234.567,89 ISK')
		expect(html).toContain('Keine Skilldaten verfügbar')
		state.character!.viewedAsCeoOrDirector = true
		state.character!.viewerRole = 'Director'
		expect(
			render('/character/:characterId', '/character/123456789', <CharacterDetailPage />)
		).toContain('Ansicht als Corporation-Direktor')
	})
})
