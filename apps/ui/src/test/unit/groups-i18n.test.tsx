import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GroupCard } from '@/components/group-card'
import { GroupForm } from '@/components/group-form'
import { GroupList } from '@/components/group-list'
import { GroupPermissionForm } from '@/components/group-permission-form'
import { JoinButton } from '@/components/join-button'
import { LeaveButton } from '@/components/leave-button'
import { PendingInvitationsList } from '@/components/pending-invitations-list'
import { TransferOwnershipDialog } from '@/components/transfer-ownership-dialog'
import { I18nProvider, setAppLocale } from '@/i18n'
import GroupDetailPage from '@/routes/group-detail'
import GroupsPage from '@/routes/groups'
import InvitationsPage from '@/routes/invitations'
import MyGroupsPage from '@/routes/my-groups'

import type { ReactNode } from 'react'
import type {
	Category,
	GroupInvitationWithDetails,
	GroupInviteCode,
	GroupMembershipSummary,
	GroupWithDetails,
} from '@/lib/api'

const state = vi.hoisted(() => ({
	groups: [] as GroupWithDetails[],
	group: undefined as GroupWithDetails | undefined,
	memberships: [] as GroupMembershipSummary[],
	invitations: [] as GroupInvitationWithDetails[],
	codes: [] as GroupInviteCode[],
	loading: false,
	invitationError: null as Error | null,
	isAdmin: true,
	mobile: false,
	pageTitle: '',
	mutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
	pendingInvitations: vi.fn(),
}))

vi.mock('@/hooks/useAuth', () => ({
	useAuth: () => ({
		user: { id: 'owner-1', is_admin: state.isAdmin, roles: [] },
		isLoading: false,
	}),
}))
vi.mock('@/hooks/usePageTitle', () => ({
	usePageTitle: (title: string) => {
		state.pageTitle = title
	},
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => state.mobile }))
vi.mock('@/hooks/useCategories', () => ({ useCategories: () => ({ data: [] }) }))
vi.mock('@/hooks/useGroups', () => ({
	useGroups: () => ({ data: state.groups, isLoading: state.loading }),
	useGroup: () => ({ data: state.group, isLoading: state.loading }),
	useUserMemberships: () => ({ data: state.memberships, isLoading: state.loading }),
	usePendingInvitations: (options: unknown) => {
		state.pendingInvitations(options)
		return { data: state.invitations, isLoading: state.loading }
	},
	useGroupInvitations: () => ({
		data: state.invitations,
		isLoading: state.loading,
		error: state.invitationError,
	}),
	useJoinRequests: () => ({ data: [], isLoading: false }),
	useSearchCharacters: () => ({ data: [], isLoading: false }),
	useRedeemInviteCode: () => state.mutation,
	useJoinGroup: () => state.mutation,
	useLeaveGroup: () => state.mutation,
	useCreateJoinRequest: () => state.mutation,
	useApproveJoinRequest: () => state.mutation,
	useRejectJoinRequest: () => state.mutation,
	useCreateInvitation: () => state.mutation,
	useAddGroupMember: () => state.mutation,
	useAcceptInvitation: () => state.mutation,
	useDeclineInvitation: () => state.mutation,
	useCancelInvitation: () => state.mutation,
	useTransferOwnership: () => state.mutation,
}))
vi.mock('@/hooks/useGroupMembers', () => ({
	useGroupMembers: () => ({ data: [], isLoading: false }),
	useRemoveMember: () => state.mutation,
	useToggleAdmin: () => state.mutation,
}))
vi.mock('@/hooks/useInviteCodes', () => ({
	useGroupInviteCodes: () => ({ data: state.codes }),
	useCreateInviteCode: () => state.mutation,
	useRevokeInviteCode: () => state.mutation,
}))

// Render controlled dialog copy in node without browser-only Radix portals.
vi.mock('@/components/ui/dialog', () => ({
	Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <>{children}</> : null,
	DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}))

const createdAt = '2026-09-10T12:00:00Z'
const category: Category = {
	id: 'category-1',
	name: 'Player Activities',
	description: null,
	visibility: 'public',
	allowGroupCreation: 'anyone',
	createdAt,
	updatedAt: createdAt,
}
const group: GroupWithDetails = {
	id: 'group-1',
	categoryId: category.id,
	category,
	name: 'Alpha Pilots',
	description: 'Player-written description',
	visibility: 'public',
	joinMode: 'open',
	mumbleSyncEnabled: false,
	ownerId: 'owner-1',
	ownerName: 'Pilot One',
	createdAt,
	updatedAt: createdAt,
	memberCount: 1234,
	isMember: false,
}
const invitation: GroupInvitationWithDetails = {
	id: 'invitation-1',
	groupId: group.id,
	inviterId: 'owner-1',
	inviteeMainCharacterId: '123',
	inviteeUserId: 'user-1',
	status: 'pending',
	createdAt,
	expiresAt: '2026-09-13T12:00:00Z',
	respondedAt: null,
	inviterCharacterName: 'Pilot One',
	inviteeCharacterName: 'Pilot Two',
	group,
}

function renderUI(children: ReactNode, path = '/groups') {
	return renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<I18nProvider>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route path="/groups/:groupId" element={children} />
						<Route path="*" element={children} />
					</Routes>
				</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}

describe('groups and invitations localization', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date(createdAt))
		vi.stubGlobal('window', { location: { origin: 'https://auth.example.test' } })
		state.groups = [group]
		state.group = group
		state.memberships = []
		state.invitations = []
		state.codes = []
		state.loading = false
		state.invitationError = null
		state.isAdmin = true
		state.mobile = false
		vi.clearAllMocks()
	})

	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	it.each([
		['en', 'Discover groups', 'Redeem invite code', 'View details'],
		['de', 'Gruppen entdecken', 'Einladungscode einlösen', 'Details anzeigen'],
		['ko', '그룹 찾기', '초대 코드 사용', '세부 정보 보기'],
	] as const)(
		'renders discovery copy and accessible controls in %s',
		async (locale, title, redeem, details) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<GroupsPage />)
			expect(html).toContain(title)
			expect(state.pageTitle).toBe(title)
			expect(html).toContain(redeem)
			expect(html).toContain(`title="${details}"`)
			expect(html).toContain('for="groups-search"')
			expect(html).toContain('Alpha Pilots')
			expect(html).toContain('Player Activities')
			expect(html).toContain('href="/groups/group-1"')
		}
	)

	it('localizes the mobile list and preserves empty-state behavior', async () => {
		await setAppLocale('ko', { persistLocal: false })
		state.mobile = true
		const html = renderUI(<GroupList groups={[group]} />)
		expect(html).toContain('자유 가입')
		expect(html).toContain('Alpha Pilots')
		expect(html).not.toContain('<table')
		expect(renderUI(<GroupList groups={[]} />)).toContain('그룹을 찾을 수 없습니다')
	})

	it('formats counts and membership dates while preserving group data', async () => {
		await setAppLocale('de', { persistLocal: false })
		const card = renderUI(<GroupCard group={group} />)
		expect(card).toContain('<span class="font-medium">1.234</span> Mitglieder')
		expect(card).toContain('Player-written description')
		expect(card).toContain('Eigentümer: Pilot One')
		state.memberships = [
			{
				groupId: group.id,
				groupName: group.name,
				categoryName: category.name,
				isOwner: false,
				isAdmin: true,
				mumbleSyncEnabled: false,
				joinedAt: createdAt,
				joinMode: 'open',
			},
		]
		const memberships = renderUI(<MyGroupsPage />, '/my-groups')
		expect(memberships).toContain('Administratorrollen')
		expect(memberships).toContain('10.09.2026')
		expect(memberships).toContain('Deaktiviert')
		expect(memberships).toContain('href="/groups/group-1"')
	})

	it('keeps owner controls hidden from members and preserves invite codes for owners', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const memberView = renderUI(<GroupDetailPage />, '/groups/group-1')
		expect(memberView).toContain('그룹 가입')
		expect(memberView).not.toContain('초대 코드 만들기')
		state.group = { ...group, isOwner: true, isMember: true }
		state.codes = [
			{
				id: 'code-1',
				groupId: group.id,
				code: 'KEEP-ME-123',
				createdBy: 'owner-1',
				maxUses: 1000,
				currentUses: 123,
				createdAt,
				expiresAt: '2026-09-20T12:00:00Z',
				revokedAt: null,
			},
		]
		const ownerView = renderUI(<GroupDetailPage />, '/groups/group-1')
		expect(ownerView).toContain('초대 코드 만들기')
		expect(ownerView).toContain('승인 없이 가입할 수 있습니다')
		expect(ownerView).toContain('사용: 123 / 1,000')
		expect(ownerView).toContain('https://auth.example.test/invite/KEEP-ME-123')
		expect(ownerView).toContain('aria-label="초대 코드 KEEP-ME-123 취소"')
		expect(ownerView).toContain('이전 후에는 그룹 관리자가 됩니다')
	})

	it.each([
		['open', '그룹 가입'],
		['approval', '가입 요청'],
		['invitation_only', '초대 전용'],
		['admin_managed', '관리자가 관리함'],
	] as const)('preserves the %s join restriction with translated copy', async (joinMode, label) => {
		await setAppLocale('ko', { persistLocal: false })
		const html = renderUI(<JoinButton group={{ ...group, joinMode }} />)
		expect(html).toContain(label)
		if (joinMode === 'invitation_only' || joinMode === 'admin_managed')
			expect(html).toContain('disabled=""')
		expect(state.mutation.mutateAsync).not.toHaveBeenCalled()
	})

	it('prevents owners and admin-managed members from leaving', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const owner = renderUI(<LeaveButton group={{ ...group, isMember: true, isOwner: true }} />)
		expect(owner).toContain('내가 소유한 그룹입니다')
		expect(owner).toContain('disabled=""')
		const managed = renderUI(
			<LeaveButton group={{ ...group, isMember: true, joinMode: 'admin_managed' }} />
		)
		expect(managed).toContain('관리자가 관리함')
		expect(managed).toContain('disabled=""')
	})

	it('localizes invitation expiry, actions, and owner-facing status labels', async () => {
		await setAppLocale('ko', { persistLocal: false })
		state.invitations = [invitation]
		const received = renderUI(<InvitationsPage />, '/invitations')
		expect(received).toContain('3일 후 만료')
		expect(received).toContain('수락')
		expect(received).toContain('거절')
		const sent = renderUI(<PendingInvitationsList groupId={group.id} />)
		expect(sent).toContain('초대한 사람: Pilot One')
		expect(sent).toContain('대기 중')
		expect(sent).toContain('aria-label="Pilot Two 님의 초대 취소"')
	})

	it('keeps invitation access gated and translates loading and error states', async () => {
		await setAppLocale('de', { persistLocal: false })
		state.isAdmin = false
		expect(renderUI(<InvitationsPage />, '/invitations')).toBe('')
		expect(state.pendingInvitations).toHaveBeenCalledWith({ enabled: false })
		state.loading = true
		expect(renderUI(<PendingInvitationsList groupId={group.id} />)).toContain(
			'Einladungen werden geladen…'
		)
		state.loading = false
		state.invitationError = new Error('Upstream')
		expect(renderUI(<PendingInvitationsList groupId={group.id} />)).toContain(
			'Einladungen konnten nicht geladen werden'
		)
	})

	it('preserves the ownership warning and treats interpolated group names as text', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const html = renderUI(
			<TransferOwnershipDialog
				group={{ ...group, name: '<script>not markup</script>' }}
				members={[]}
				open
				onOpenChange={() => {}}
			/>
		)
		expect(html).toContain('이 작업은 실행 취소할 수 없습니다')
		expect(html).toContain('&lt;script&gt;not markup&lt;/script&gt;')
		expect(html).not.toContain('<script>not markup</script>')
	})

	it('localizes group and permission forms without translating protocol examples', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const groupForm = renderUI(
			<GroupForm categories={[category]} onSubmit={() => {}} onCancel={() => {}} />
		)
		expect(groupForm).toContain('placeholder="그룹 이름 입력"')
		expect(groupForm).toContain('공개(로그인한 모든 사용자에게 표시)')
		const permissions = renderUI(
			<GroupPermissionForm groupId={group.id} onSubmit={async () => {}} onCancel={() => {}} />
		)
		expect(permissions).toContain('모든 멤버')
		expect(permissions).toContain('placeholder="urn:namespace:action"')
		expect(permissions).toContain('placeholder="함대 지휘관"')
	})
})
