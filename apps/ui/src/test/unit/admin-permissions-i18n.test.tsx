import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminNav } from '@/components/admin-nav'
import { AttachPermissionDialog } from '@/components/attach-permission-dialog'
import { PermissionCategoryForm } from '@/components/permission-category-form'
import { PermissionFormDialog } from '@/components/permission-form-dialog'
import { PermissionUsageDialog } from '@/components/permission-usage-dialog'
import { permissionCategoryKeys } from '@/hooks/usePermissionCategories'
import { permissionKeys } from '@/hooks/usePermissions'
import { I18nProvider, setAppLocale } from '@/i18n'
import AdminLayout from '@/routes/admin/layout'
import PermissionCategoriesPage from '@/routes/admin/permissions/categories'
import GlobalPermissionsPage from '@/routes/admin/permissions/global'

import type { ReactNode } from 'react'
import type {
	GroupPermissionWithDetails,
	PermissionCategory,
	PermissionWithDetails,
} from '@/lib/api'

// Replace portals for server rendering, retaining the dialogs' controlled visibility.
vi.mock('@/components/ui/dialog', () => ({
	Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <>{children}</> : null,
	DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}))

const category: PermissionCategory = {
	id: 'category-original',
	name: 'Fleet Original',
	description: 'Original description',
	createdAt: '2026-09-13',
	updatedAt: '2026-09-13',
}
const permission: PermissionWithDetails = {
	id: 'permission-original',
	urn: 'urn:broadcasts:corp:fleet:manage',
	name: 'Permission Original',
	description: 'Original access',
	categoryId: category.id,
	category,
	createdBy: 'creator-original',
	createdAt: '2026-09-13',
	updatedAt: '2026-09-13',
}
const clients: QueryClient[] = []
function createClient() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	clients.push(client)
	client.setQueryData(permissionCategoryKeys.list(), [category])
	client.setQueryData(permissionKeys.list(), [permission])
	client.setQueryData(['admin-nav', 'legacy-migrations', 'pending-count'], 100)
	return client
}
function render(children: ReactNode, path = '/admin/permissions/global', client = createClient()) {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}

describe('admin shell and permission localization', () => {
	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
		clients.splice(0).forEach((client) => client.clear())
	})

	it.each([
		['en', 'Users', 'Global Permissions', 'Create Permission', 'Language'],
		['de', 'Benutzer', 'Globale Berechtigungen', 'Berechtigung erstellen', 'Sprache'],
		['ko', '사용자', '전역 권한', '권한 만들기', '언어'],
	] as const)(
		'renders admin navigation and permission management in %s',
		async (locale, users, global, create, language) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(
				<>
					<AdminNav />
					<GlobalPermissionsPage />
					<PermissionFormDialog categories={[category]} onCancel={vi.fn()} onSubmit={vi.fn()} />
				</>
			)
			for (const label of [
				users,
				global,
				create,
				language,
				permission.name,
				permission.urn,
				category.name,
				'99+',
			])
				expect(html).toContain(label)
			for (const path of [
				'/admin/users',
				'/admin/permissions/categories',
				'/admin/permissions/global',
				'/dashboard',
			])
				expect(html).toContain(`href="${path}"`)
			expect(html).not.toContain('admin.permissions.')
		}
	)

	it.each([
		['en', 'Category Name', 'No categories yet', 'No permissions yet'],
		['de', 'Kategoriename', 'Noch keine Kategorien', 'Noch keine Berechtigungen'],
		['ko', '카테고리 이름', '아직 카테고리가 없습니다', '아직 권한이 없습니다'],
	] as const)(
		'renders category editing and empty registries in %s',
		async (locale, name, categories, permissions) => {
			await setAppLocale(locale, { persistLocal: false })
			const client = createClient()
			client.setQueryData(permissionCategoryKeys.list(), [])
			client.setQueryData(permissionKeys.list(), [])
			const html = render(
				<>
					<PermissionCategoriesPage />
					<GlobalPermissionsPage />
					<PermissionCategoryForm category={category} onCancel={vi.fn()} onSubmit={vi.fn()} />
				</>,
				undefined,
				client
			)
			for (const label of [name, categories, permissions, category.name, category.description!])
				expect(html).toContain(label)
		}
	)

	it('keeps editing URNs immutable and displays protocol examples verbatim', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const html = render(
			<PermissionFormDialog
				permission={permission}
				categories={[category]}
				onCancel={vi.fn()}
				onSubmit={vi.fn()}
			/>
		)
		expect(html).toMatch(
			/<input[^>]+id="urn"[^>]+disabled=""[^>]+value="urn:broadcasts:corp:fleet:manage"/
		)
		expect(html).toContain('URN은 변경할 수 없습니다')
		expect(html).toContain(
			'urn:broadcasts:&lt;entity-namespace&gt;:&lt;target-name&gt;:&lt;send|manage&gt;'
		)
		expect(html).toContain('value="Permission Original"')
	})

	it('localizes attachment targets and preserves the closed dialog gate', async () => {
		await setAppLocale('de', { persistLocal: false })
		const props = { groupId: 'group-original', onOpenChange: vi.fn(), onSubmit: vi.fn() }
		const html = render(<AttachPermissionDialog {...props} open />)
		expect(html).toContain('Globale Berechtigung zuweisen')
		expect(html).toContain('Alle Mitglieder')
		expect(html).toContain(permission.urn)
		expect(render(<AttachPermissionDialog {...props} open={false} />)).toBe('')
	})

	it('keeps supplied permission names as text in usage descriptions', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const html = render(
			<PermissionUsageDialog
				permissionName="<Original>"
				permissionUrn={permission.urn}
				groupPermissions={[]}
				open
				onOpenChange={vi.fn()}
			/>
		)
		expect(html).toContain('&lt;Original&gt;')
		expect(html).toContain('이 권한을 사용하는 그룹이 없습니다')
		expect(html).toContain(permission.urn)
	})

	it('translates route breadcrumbs without translating or reformatting entity IDs', async () => {
		await setAppLocale('de', { persistLocal: false })
		const client = createClient()
		client.setQueryData(['auth', 'session'], { authenticated: true, user: { is_admin: true } })
		const html = render(<AdminLayout />, '/admin/users/permissions/discord-access', client)
		expect(html).toMatch(/href="\/admin\/users\/permissions"[^>]*>permissions<\/a>/)
		expect(html).toMatch(/aria-current="page"[^>]*>Discord-Zugriff<\/span>/)
	})

	it('renders singular and plural permission usage counts and group links', async () => {
		await setAppLocale('de', { persistLocal: false })
		const attachment: GroupPermissionWithDetails = {
			id: 'attachment-original',
			groupId: 'group-original',
			permissionId: permission.id,
			customUrn: null,
			customName: null,
			customDescription: null,
			targetType: 'owner_only',
			createdBy: 'creator-original',
			createdAt: '2026-09-13',
			permission,
			group: { id: 'group-original', name: 'Group Original' },
		}
		const props = {
			permissionName: permission.name,
			permissionUrn: permission.urn,
			open: true,
			onOpenChange: vi.fn(),
		}
		const html = render(<PermissionUsageDialog {...props} groupPermissions={[attachment]} />)
		expect(html).toContain('Wird von 1 Gruppe verwendet')
		expect(html).toContain('href="/admin/groups/group-original"')
		expect(
			render(
				<PermissionUsageDialog
					{...props}
					groupPermissions={[attachment, { ...attachment, id: 'second' }]}
				/>
			)
		).toContain('Wird von 2 Gruppen verwendet')
	})

	it('keeps the auth and administrator gates around the translated shell', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const client = createClient()
		expect(render(<AdminLayout />, undefined, client)).toContain(
			'aria-label="관리 패널 불러오는 중…"'
		)
		client.setQueryData(['auth', 'session'], { authenticated: false, user: null })
		expect(render(<AdminLayout />, undefined, client)).toContain('aria-label="로그인으로 이동 중…"')
		client.setQueryData(['auth', 'session'], { authenticated: true, user: { is_admin: false } })
		expect(render(<AdminLayout />, undefined, client)).not.toContain('href="/admin/users"')
	})
})
