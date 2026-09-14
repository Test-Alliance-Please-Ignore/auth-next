import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IpHashInspectionPage } from '@/components/ip-hash-inspection-page'
import { IpHistoryCard } from '@/components/ip-history-card'
import { AddHRNoteDialog } from '@/features/applications/components/add-hr-note-dialog'
import { HRNoteCard } from '@/features/applications/components/hr-note-card'
import { adminUserKeys } from '@/hooks/useAdminUsers'
import { BreadcrumbProvider } from '@/hooks/useBreadcrumb'
import { I18nProvider, setAppLocale } from '@/i18n'
import AdminUserActivityPage from '@/routes/admin/user-activity'
import UserDetailPage from '@/routes/admin/user-detail'
import AdminUserDiscordAccessPage from '@/routes/admin/user-discord-access'
import AdminUserGroupsPage from '@/routes/admin/user-groups'
import AdminUserOAuthInspectionPage from '@/routes/admin/user-oauth-inspection'
import UsersPage from '@/routes/admin/users'

import type { ReactNode } from 'react'
import type { HRNote } from '@/features/applications/api'
import type { AdminUserDetail, UserIpHistoryEntry } from '@/lib/api'

// Only replace portals; queries, route params, translation and rendering remain real.
vi.mock('@/components/ui/dialog', () => ({
	Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <>{children}</> : null,
	DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}))

const date = '2026-01-01T12:00:00Z'
const user: AdminUserDetail = {
	id: 'user-original',
	mainCharacterId: '1234567',
	is_admin: false,
	discordUserId: '987654321012345678',
	discord: {
		userId: '987654321012345678',
		username: 'Discord Original',
		discriminator: '0',
		authRevoked: false,
		authRevokedAt: null,
		lastSuccessfulAuth: date,
	},
	characters: [
		{
			characterId: '1234567',
			characterName: 'Pilot <Original>',
			characterOwnerHash: 'owner-original',
			is_primary: true,
			linkedAt: date,
			hasValidToken: true,
			isBlacklisted: false,
		},
	],
	groupMemberships: [
		{
			groupId: 'group-original',
			groupName: 'Group Original',
			membershipLevel: 'owner',
			joinedAt: date,
		},
	],
	permissionGrants: [
		{
			urn: 'urn:corp:read',
			name: 'Permission Original',
			description: 'Description Original',
			groupId: 'group-original',
			groupName: 'Group Original',
			targetType: 'owner_only',
			source: 'group_scoped',
		},
	],
	createdAt: date,
	updatedAt: date,
}
const note: HRNote = {
	id: 'note-original',
	subjectUserId: user.id,
	subjectCharacterId: '1234567',
	subjectCharacterName: 'Pilot <Original>',
	authorId: 'author-original',
	authorCharacterId: '1234568',
	authorCharacterName: 'Author Original',
	noteText: 'Raw note <script>original</script>',
	noteType: 'warning',
	priority: 'critical',
	metadata: { visibility: 'admin' },
	createdAt: date,
	updatedAt: date,
}
const entries: UserIpHistoryEntry[] = [
	{
		ipAddressHash: 'hash-original',
		firstSeenAt: date,
		lastSeenAt: date,
		seenCount: 1234,
		distinctUserCount: 2,
	},
]
const clients: QueryClient[] = []
function createClient() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	clients.push(client)
	client.setQueryData(adminUserKeys.detail(user.id), user)
	client.setQueryData(adminUserKeys.ipHistory(user.id), { entries })
	client.setQueryData(['auth', 'session'], {
		authenticated: true,
		user: { id: 'admin-original', is_admin: true },
	})
	client.setQueryData(['feature-flags'], { 'mumble.enabled': false })
	return client
}
function render(children: ReactNode, client = createClient()) {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<BreadcrumbProvider>
					<MemoryRouter initialEntries={['/admin/users/user-original']}>
						<Routes>
							<Route path="/admin/users/:userId" element={children} />
						</Routes>
					</MemoryRouter>
				</BreadcrumbProvider>
			</I18nProvider>
		</QueryClientProvider>
	)
}

describe('admin account localization', () => {
	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
		clients.splice(0).forEach((client) => client.clear())
	})

	it.each([
		['en', 'User Management', 'Grant Admin', 'Discord Account', 'Owner'],
		['de', 'Benutzerverwaltung', 'Administratorrechte gewähren', 'Discord-Konto', 'Eigentümer'],
		['ko', '사용자 관리', '관리자 권한 부여', 'Discord 계정', '소유자'],
	] as const)(
		'renders account controls and grants in %s without changing identity data',
		async (locale, title, grant, discord, owner) => {
			await setAppLocale(locale, { persistLocal: false })
			const client = createClient()
			client.setQueryData(adminUserKeys.list({ page: 1, pageSize: 25 }), {
				data: [
					{
						...user,
						mainCharacterName: 'Pilot <Original>',
						characterCount: 1234,
						discordUsername: 'Discord Original',
						matchedBy: null,
					},
				],
				pagination: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 },
			})
			const html = render(
				<>
					<UsersPage />
					<UserDetailPage />
					<AdminUserGroupsPage />
				</>,
				client
			)
			for (const text of [
				title,
				grant,
				discord,
				owner,
				'Pilot &lt;Original&gt;',
				'Group Original',
				'urn:corp:read',
				'987654321012345678',
			])
				expect(html.includes(text), text).toBe(true)
			expect(html).toContain('href="/admin/users/user-original"')
			expect(html).toContain(locale === 'de' ? '1.234' : '1,234')
			expect(html).not.toContain('admin.users.')
			expect(html).not.toContain('owner_only')
		}
	)

	it.each([
		['en', 'Login', 'Resolver Payload', 'Missing (1)'],
		['de', 'Anmeldung', 'Resolver-Daten', 'Fehlend (1)'],
		['ko', '로그인', '리졸버 데이터', '누락 (1)'],
	] as const)(
		'translates inspection labels in %s while keeping audit and OAuth payloads intact',
		async (locale, login, payload, missing) => {
			await setAppLocale(locale, { persistLocal: false })
			const client = createClient()
			client.setQueryData(adminUserKeys.activityLog({ userId: user.id, pageSize: 100 }), {
				data: ['login', 'future_action_original'].map((action) => ({
					id: action,
					userId: user.id,
					action,
					createdAt: date,
					metadata: { action: 'login', original: '<raw>' },
				})),
			})
			client.setQueryData([...adminUserKeys.detail(user.id), 'oauth-inspection'], {
				userId: user.id,
				inspectedAt: date,
				scopes: ['profile', 'groups', 'permissions'],
				response: {
					sub: user.id,
					scope: ['profile'],
					permissionUrns: ['urn:corp:read'],
					groups: ['Group Original'],
				},
			})
			const role = {
				roleId: '987654321012345679',
				roleName: 'Role Original',
				nameSource: 'discord',
			}
			client.setQueryData(adminUserKeys.discordInspection(user.id), {
				userId: user.id,
				discordUserId: user.discordUserId,
				inspectedAt: date,
				summary: {
					guildsInspected: 1,
					memberGuilds: 1,
					guildsWithDrift: 1,
					totalMissingExpectedManagedRoles: 1,
					totalUnexpectedManagedRoles: 0,
					totalUnmanagedCurrentRoles: 0,
				},
				guilds: [
					{
						guildId: 'guild-original',
						guildName: 'Guild Original',
						isMember: true,
						expectedManagedRoles: [role],
						currentManagedRoles: [],
						currentUnmanagedRoles: [],
						missingExpectedManagedRoles: [role],
						unexpectedManagedRoles: [],
					},
				],
			})
			const html = render(
				<>
					<AdminUserActivityPage />
					<AdminUserOAuthInspectionPage />
					<AdminUserDiscordAccessPage />
				</>,
				client
			)
			for (const text of [
				login,
				payload,
				missing,
				'Role Original',
				'Guild Original',
				'987654321012345679',
				'future_action_original',
				'&quot;action&quot;: &quot;login&quot;',
				'urn:corp:read',
				'&lt;raw&gt;',
			])
				expect(html.includes(text), text).toBe(true)
			expect(html).not.toContain('admin.users.')
		}
	)

	it.each([
		[
			'en',
			'1 additional match',
			'1,234 sightings',
			'Admin-only',
			'Warning',
			'Critical',
			'Save Note',
		],
		[
			'de',
			'1 weiterer Treffer',
			'1.234 Sichtungen',
			'Nur Administratoren',
			'Warnung',
			'Kritisch',
			'Notiz speichern',
		],
		['ko', '추가 일치 1건', '관측 1,234회', '관리자 전용', '경고', '긴급', '메모 저장'],
	] as const)(
		'localizes shared IP and private note components in %s',
		async (locale, matches, sightings, privacy, warning, critical, save) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(
				<>
					<IpHistoryCard
						title="IP fixture"
						entries={entries}
						buildHashInspectionLink={(hash) => `/admin/ip-history/${hash}`}
					/>
					<IpHashInspectionPage
						hash="hash-original"
						matches={[
							{
								userId: user.id,
								mainCharacterId: user.mainCharacterId,
								mainCharacterName: 'Pilot <Original>',
								isAdmin: false,
								seenCount: 1234,
								firstSeenAt: date,
								lastSeenAt: date,
							},
						]}
						isLoading={false}
						backTo="/admin/users"
						backLabel="Back fixture"
						buildUserLink={(id) => `/admin/users/${id}`}
						buildHashLink={(hash) => `/admin/ip-history/${hash}`}
						loadUserHashes={vi.fn()}
					/>
					<HRNoteCard note={note} showSubject onEdit={vi.fn()} onDelete={vi.fn()} />
					<AddHRNoteDialog
						open
						onOpenChange={vi.fn()}
						subjectUserId={user.id}
						subjectCharacterId={user.mainCharacterId}
						subjectCharacterName="Pilot <Original>"
					/>
				</>
			)
			for (const text of [
				matches,
				sightings,
				privacy,
				warning,
				critical,
				save,
				'hash-original',
				'Pilot &lt;Original&gt;',
				'Raw note &lt;script&gt;original&lt;/script&gt;',
			])
				expect(html.includes(text), text).toBe(true)
			expect(html).toContain('href="/admin/ip-history/hash-original"')
			expect(html).not.toContain('<script>')
			expect(html).not.toContain('hr.notes.')
		}
	)

	it('retains the closed note dialog gate and localizes imported author fallback', async () => {
		await setAppLocale('ko', { persistLocal: false })
		expect(
			render(<AddHRNoteDialog open={false} onOpenChange={vi.fn()} subjectUserId={user.id} />)
		).toBe('')
		const html = render(
			<HRNoteCard
				note={{
					...note,
					metadata: {
						source: 'legacy_import',
						legacyNoteActorResolution: 'unresolved_importer_fallback',
					},
				}}
			/>
		)
		expect(html).toContain('기존 시스템 사용자')
		expect(html).not.toContain('Author Original')
		expect(html).toContain('Raw note &lt;script&gt;original&lt;/script&gt;')
	})
})
