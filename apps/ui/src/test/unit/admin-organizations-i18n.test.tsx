import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AddDirectorDialog } from '@/components/AddDirectorDialog'
import { CorporationAlertsCard } from '@/components/admin/corporation-alerts-card'
import { DirectorStatusBadge } from '@/components/DirectorStatusBadge'
import { ReassignCategoryDialog } from '@/components/reassign-category-dialog'
import { BreadcrumbProvider } from '@/hooks/useBreadcrumb'
import { categoryKeys } from '@/hooks/useCategories'
import { corporationKeys } from '@/hooks/useCorporations'
import { groupMemberKeys } from '@/hooks/useGroupMembers'
import { groupKeys } from '@/hooks/useGroups'
import { I18nProvider, setAppLocale } from '@/i18n'
import CorporationDetailPage from '@/routes/admin/corporation-detail'
import CorporationsPage from '@/routes/admin/corporations'
import GroupDetailPage from '@/routes/admin/group-detail'
import GroupsPage from '@/routes/admin/groups'

import {
	organizationCorporation as corporation,
	organizationDestination as destination,
	organizationDirector as director,
	organizationGroup as group,
} from '../fixtures/admin-organizations'

import type { ReactNode } from 'react'

vi.mock('@/components/ui/dialog', () => ({
	Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <>{children}</> : null,
	DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}))

const clients: QueryClient[] = []
function createClient() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	clients.push(client)
	client.setQueryData(['auth', 'session'], {
		authenticated: true,
		user: { id: 'admin-original', is_admin: true },
	})
	client.setQueryData(groupKeys.list({}), [group])
	client.setQueryData(groupKeys.detail(group.id), group)
	client.setQueryData(groupMemberKeys.list(group.id), [])
	client.setQueryData(categoryKeys.list(), [group.category])
	client.setQueryData(corporationKeys.list({ corporationType: 'member', page: 1, pageSize: 25 }), {
		data: [corporation],
		pagination: { page: 1, pageSize: 25, totalCount: 1234, totalPages: 50 },
	})
	client.setQueryData(corporationKeys.detail(corporation.corporationId), corporation)
	client.setQueryData(corporationKeys.directors(corporation.corporationId), [director])
	client.setQueryData(corporationKeys.alertTypes(), [
		{
			type: 'corp_application_submitted',
			label: 'Server label original',
			description: 'Server description original',
			supportedDestinationTypes: ['discord_webhook'],
		},
	])
	client.setQueryData(corporationKeys.alerts(corporation.corporationId), [destination])
	return client
}
function render(
	children: ReactNode,
	path = '/admin/groups/group-original',
	client = createClient()
) {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<BreadcrumbProvider>
					<MemoryRouter initialEntries={[path]}>
						<Routes>
							<Route path="/admin/groups/:groupId" element={children} />
							<Route path="/admin/corporations/:corporationId" element={children} />
						</Routes>
					</MemoryRouter>
				</BreadcrumbProvider>
			</I18nProvider>
		</QueryClientProvider>
	)
}

describe('admin organization localization', () => {
	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
		clients.splice(0).forEach((client) => client.clear())
	})

	it.each([
		['en', 'Groups Overview', 'Group Management', 'Reassign Group Category', 'Delete Group'],
		['de', 'Gruppenübersicht', 'Gruppenverwaltung', 'Gruppenkategorie ändern', 'Gruppe löschen'],
		['ko', '그룹 개요', '그룹 관리', '그룹 카테고리 변경', '그룹 삭제'],
	] as const)(
		'renders group management and category controls in %s',
		async (locale, overview, management, reassign, remove) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(
				<>
					<GroupsPage />
					<GroupDetailPage />
					<ReassignCategoryDialog group={group} open onOpenChange={vi.fn()} />
				</>
			)
			for (const text of [
				overview,
				management,
				reassign,
				remove,
				'Group &lt;Original&gt;',
				'Category Original',
				'Original group description',
				locale === 'de' ? '1.234' : '1,234',
			])
				expect(html.includes(text), text).toBe(true)
			expect(html).toContain('href="/admin/groups/group-original"')
			expect(html).not.toContain('admin.organizations.')
			expect(html).not.toContain('<Original>')
		}
	)

	it.each([
		['en', 'Managed Corporations (1,234)', 'Add Director', 'Structure asset sync'],
		[
			'de',
			'Verwaltete Corporations (1.234)',
			'Direktor hinzufügen',
			'Strukturinventarsynchronisierung',
		],
		['ko', '관리 중인 코퍼레이션 (1,234)', '디렉터 추가', '구조물 자산 동기화'],
	] as const)(
		'renders corporation configuration and director forms in %s',
		async (locale, managed, add, structure) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(
				<>
					<CorporationsPage />
					<CorporationDetailPage />
					<AddDirectorDialog
						corporationId={corporation.corporationId}
						open
						onOpenChange={vi.fn()}
					/>
				</>,
				'/admin/corporations/98000001'
			)
			for (const text of [
				managed,
				add,
				structure,
				'Corporation Original',
				'Director Original',
				'2119123456',
				locale === 'de' ? '1.234' : '1,234',
			])
				expect(html.toLowerCase().includes(text.toLowerCase()), text).toBe(true)
			expect(html).toContain('href="/admin/corporations/98000001"')
			expect(html).toContain('inputMode="numeric"')
			expect(html).not.toContain('admin.organizations.')
		}
	)

	it.each([
		['en', 'Alert Destinations', 'Corp Application Submitted', 'Discord Webhook', 'Save'],
		[
			'de',
			'Benachrichtigungsziele',
			'Corporation-Bewerbung eingereicht',
			'Discord-Webhook',
			'Speichern',
		],
		['ko', '알림 대상', '코퍼레이션 지원서 제출', 'Discord 웹훅', '저장'],
	] as const)(
		'localizes known alert types and destination controls in %s while preserving webhook data',
		async (locale, title, submitted, webhook, save) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(
				<CorporationAlertsCard corporationId={corporation.corporationId} />,
				'/admin/corporations/98000001'
			)
			for (const text of [
				title,
				submitted,
				webhook,
				save,
				'https://discord.com/api/webhooks/example/original',
			])
				expect(html.includes(text), text).toBe(true)
			expect(html).not.toContain('Server label original')
			expect(html).not.toContain('admin.organizations.')
		}
	)

	it('preserves administrator-managed group gates and closed forms', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const client = createClient()
		client.setQueryData(groupKeys.detail(group.id), { ...group, joinMode: 'admin_managed' })
		const html = render(<GroupDetailPage />, undefined, client)
		expect(html).toContain('관리자 관리')
		expect(html).not.toContain('초대 코드 만들기')
		expect(
			render(
				<>
					<ReassignCategoryDialog group={group} open={false} onOpenChange={vi.fn()} />
					<AddDirectorDialog
						corporationId={corporation.corporationId}
						open={false}
						onOpenChange={vi.fn()}
					/>
				</>
			)
		).toBe('')
	})

	it('distinguishes unchecked, healthy, and failed directors after changing locale', async () => {
		await setAppLocale('de', { persistLocal: false })
		expect(
			render(<DirectorStatusBadge director={{ ...director, lastHealthCheck: null }} />)
		).toContain('Überprüfung erforderlich')
		expect(render(<DirectorStatusBadge director={{ ...director, isHealthy: true }} />)).toContain(
			'Funktionsfähig'
		)
		expect(render(<DirectorStatusBadge director={director} />)).toContain('(1.234 Fehler)')
		await setAppLocale('ko', { persistLocal: false })
		expect(render(<DirectorStatusBadge director={{ ...director, failureCount: 1 }} />)).toContain(
			'(1회 실패)'
		)
		expect(
			render(<DirectorStatusBadge director={director} showFailureCount={false} />)
		).not.toContain('1,234')
	})

	it('shows server-defined alert types verbatim when the client has no matching definition', async () => {
		await setAppLocale('de', { persistLocal: false })
		const client = createClient()
		client.setQueryData(corporationKeys.alertTypes(), [
			{
				type: 'future-original',
				label: 'Future <Original>',
				description: 'Original future description',
				supportedDestinationTypes: [],
			},
		])
		const html = render(
			<CorporationAlertsCard corporationId={corporation.corporationId} />,
			'/admin/corporations/98000001',
			client
		)
		expect(html).toContain('Future &lt;Original&gt;')
		expect(html).toContain('Original future description')
	})
})
