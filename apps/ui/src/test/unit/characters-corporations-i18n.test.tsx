import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CharacterAttributes } from '@/components/character-attributes'
import { CharacterCorporationHistory } from '@/components/character-corporation-history'
import { CharacterPrivateInfo } from '@/components/character-private-info'
import { CharacterSkillQueue } from '@/components/character-skill-queue'
import { CharacterSkills } from '@/components/character-skills'
import { CopyableMetaPill } from '@/components/copyable-meta-pill'
import { EsiStatusBadge } from '@/components/esi-status-badge'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import {
	CharacterIdentitySummary,
	CharacterSpWalletLine,
} from '@/features/applications/components/character-identity-summary'
import { CharacterRoleBadge } from '@/features/applications/components/character-role-badge'
import { buildCorporationMembersExportUrl, sortMembers } from '@/features/corporations/api'
import CorporationMembersTable from '@/features/corporations/components/corporation-members-table'
import { EmeritusConfirmationDialog } from '@/features/corporations/components/emeritus-confirmation-dialog'
import { UserSearchCard } from '@/features/corporations/components/user-search-card'
import { formatCorporationRoleLabel } from '@/features/corporations/hooks'
import { HrRoleBadge } from '@/features/hr/components/hr-role-badge'
import { useRefreshCharacter } from '@/hooks/useCharacters'
import { I18nProvider, setAppLocale } from '@/i18n'
import { api } from '@/lib/api'

import type { ReactNode } from 'react'
import type { CorporationMember } from '@/features/corporations/api'
import type { UserSearchCardEntry } from '@/features/corporations/components/user-search-card'
import type { UseApiMutationOptions } from '@/hooks/useApiMutation'

const captured = vi.hoisted(() => ({ options: null as unknown }))
vi.mock('@/hooks/useApiMutation', () => ({
	useApiMutation: (options: unknown) => {
		captured.options = options
		return { isPending: false }
	},
}))

// Only replace browser portals; retain the controlled open state and real dialog content.
vi.mock('@/components/ui/dialog', () => ({
	Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <>{children}</> : null,
	DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}))

const member: CorporationMember = {
	characterId: '123456789',
	characterName: 'Pilot Original',
	corporationId: '987654321',
	corporationName: 'Original Corp',
	role: 'Director',
	hasAuthAccount: true,
	hasValidToken: false,
	authUserId: 'account-1',
	mainCharacterName: 'Original Main',
	joinDate: '2020-01-01',
	lastEsiUpdate: '2026-09-10',
	lastLogin: '2020-01-01',
	activityStatus: 'inactive',
	isBlacklisted: false,
}

function render(children: ReactNode, client = new QueryClient()) {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MemoryRouter>{children}</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}

describe('character and corporation translations', () => {
	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
		vi.restoreAllMocks()
	})

	it.each([
		['en', 'Loading private character details', 'Main', 'Alt'],
		['de', 'Private Charakterdaten werden geladen', 'Hauptcharakter', 'Alt'],
		['ko', '캐릭터 비공개 정보 불러오는 중', '메인', '부캐'],
	] as const)(
		'localizes private-detail loading and character roles in %s',
		async (locale, loading, main, alt) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(
				<>
					<CharacterSpWalletLine skillPoints={null} walletBalance={null} isLoading />
					<CharacterRoleBadge role="main" />
					<CharacterRoleBadge role="alt" />
				</>
			)
			expect(html).toContain(`aria-label="${loading}"`)
			expect(html).toContain('aria-busy="true"')
			expect(html).toContain(`>${main}</`)
			expect(html).toContain(`>${alt}</`)
		}
	)

	it.each([
		['en', 'Attributes', 'Corporation History', 'Skill Queue', 'Skills'],
		['de', 'Attribute', 'Corporation-Verlauf', 'Skill-Warteschlange', 'Skills'],
		['ko', '속성', '코퍼레이션 이력', '스킬 대기열', '스킬'],
	] as const)(
		'renders character sections and empty states in %s',
		async (locale, attributes, history, queue, skills) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(
				<>
					<CharacterAttributes
						attributes={{
							intelligence: 20,
							perception: 21,
							memory: 22,
							willpower: 23,
							charisma: 24,
							bonusRemaps: 2,
						}}
					/>
					<CharacterCorporationHistory history={[]} />
					<CharacterSkillQueue queue={[]} />
					<CharacterSkills characterId="123456789" skills={{ totalSp: 0, skills: [] }} />
				</>
			)
			for (const label of [attributes, history, queue, skills]) expect(html).toContain(label)
			expect(html).toContain('/images/types/')
			expect(html).not.toContain('characterDetail.')
		}
	)

	it('localizes private data formatting and stale-token warnings without changing names or IDs', async () => {
		await setAppLocale('de', { persistLocal: false })
		const html = render(
			<CharacterPrivateInfo
				sensitiveDataIsLive={false}
				location={{
					solarSystemId: 30000142,
					solarSystemName: 'Jita',
					stationId: 60003760,
					stationName: 'Jita IV - Moon 4',
				}}
				wallet={{ balance: '1234567.89' }}
				status={{ online: true }}
			/>
		)
		for (const text of [
			'Letzter bekannter Standort',
			'1.234.567,89 ISK',
			'Live-Statusaktualisierungen',
			'Jita IV - Moon 4',
			'System-ID: 30000142',
		])
			expect(html).toContain(text)
		expect(html).not.toContain('>Online<')
	})

	it('localizes history overflow and skill queue plurals while preserving canonical skill names and levels', async () => {
		await setAppLocale('de', { persistLocal: false })
		const history = Array.from({ length: 6 }, (_, index) => ({
			recordId: index,
			corporationId: 100 + index,
			corporationName: `Corp ${index}`,
			startDate: '2020-01-01',
			isDeleted: index === 0,
		}))
		const queue = Array.from({ length: 11 }, (_, index) => ({
			queuePosition: index,
			skillId: 3300 + index,
			skillName: 'Gunnery',
			finishedLevel: 5,
		}))
		const html = render(
			<>
				<CharacterCorporationHistory history={history} />
				<CharacterSkillQueue queue={queue} />
			</>
		)
		expect(html).toContain('Und 1 weiterer Eintrag…')
		expect(html).toContain('Und 1 weiterer Skill in der Warteschlange…')
		expect(html).toContain('Gunnery V')
		expect(html).toContain('(Geschlossen)')
	})

	it('renders member roles, filters, dates, and account links in Korean', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const html = render(
			<CorporationMembersTable
				members={[member]}
				corporationId={member.corporationId}
				query={{ roleFilter: 'Director', authFilter: 'linked_invalid' }}
				onQueryChange={vi.fn()}
			/>
		)
		for (const text of [
			'전체 멤버',
			'디렉터',
			'가입일',
			'Pilot Original',
			'Original Main',
			'멤버 검색…',
		])
			expect(html).toContain(text)
		expect(html).toContain('href="/corporations/987654321/members/account-1"')
		expect(html).toContain('/images/characters/123456789/portrait')
		expect(html).toContain('2020. 1. 1.')
		expect(html).toMatch(/<label[^>]+for="([^"]+-role)"[^>]*>역할<\/label>/)
		expect(html).not.toContain('ESI Invalid')
		expect(html).not.toContain('Per page:')
	})

	it('keeps account-less character links, loading states, and empty states intact', async () => {
		await setAppLocale('de', { persistLocal: false })
		const props = { corporationId: member.corporationId, query: {}, onQueryChange: vi.fn() }
		expect(render(<CorporationMembersTable {...props} members={[]} loading />)).toContain(
			'Mitglieder werden geladen…'
		)
		expect(render(<CorporationMembersTable {...props} members={[]} />)).toContain(
			'Für die aktuellen Filter wurden keine Mitglieder gefunden.'
		)
		expect(
			render(
				<CorporationMembersTable
					{...props}
					members={[{ ...member, hasAuthAccount: false }]}
					showActions={false}
				/>
			)
		).toContain('href="/character/123456789"')
	})

	it('preserves the emeritus warning, submitted role semantics, and closed dialog gate', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const props = {
			member,
			action: 'mark' as const,
			onOpenChange: vi.fn(),
			onSubmit: vi.fn(),
			isSubmitting: false,
		}
		const html = render(<EmeritusConfirmationDialog {...props} open />)
		expect(html).toContain('소유자가 세상을 떠난 캐릭터를 위한 상태입니다')
		expect(html).toContain('즉시 차단 목록에 추가해야 합니다')
		expect(html).toContain('디렉터')
		expect(html).toContain('Pilot Original')
		expect(render(<EmeritusConfirmationDialog {...props} open={false} />)).toBe('')
		expect(member.role).toBe('Director')
	})

	it('localizes identity, copy controls, role tooltips, and unlinked status', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const html = render(
			<>
				<CharacterIdentitySummary
					characterId={123456789}
					characterName="Pilot Original"
					hasValidToken={null}
					enableCopyName
					onCopyName={vi.fn()}
				/>
				<CopyableMetaPill label="Discord ID" value="123456789" />
				<HrRoleBadge role="hr_viewer" />
				<EsiStatusBadge hasAuthAccount={false} hasValidToken={true} />
			</>
		)
		expect(html).toContain('aria-label="Pilot Original을(를) 클립보드에 복사"')
		expect(html).toContain('aria-label="Discord ID 클립보드에 복사"')
		expect(html).not.toContain('Wallet unavailable')
		expect(html).not.toContain('HR Viewer')
		expect(html).not.toContain('Unlinked')
		expect(formatCorporationRoleLabel('hr_viewer')).toBe('HR 열람자')
	})

	it('uses locale collation for member names and singular search-card counts', async () => {
		const members = [
			{ ...member, role: 'Member' as const, characterName: 'Zeta' },
			{ ...member, role: 'Member' as const, characterName: '가나다' },
			{ ...member, role: 'CEO' as const, characterName: 'CEO Original' },
		]
		await setAppLocale('ko', { persistLocal: false })
		expect(sortMembers(members).map((item) => item.characterName)).toEqual([
			'CEO Original',
			'가나다',
			'Zeta',
		])
		await setAppLocale('de', { persistLocal: false })
		expect(sortMembers(members).map((item) => item.characterName)).toEqual([
			'CEO Original',
			'Zeta',
			'가나다',
		])
		expect(members[0].characterName).toBe('Zeta')
		const user: UserSearchCardEntry = {
			summary: {
				id: 'account-1',
				mainCharacterId: '1',
				mainCharacterName: 'Original Main',
				matchedCharacterId: '1',
				matchedCharacterName: 'Original Main',
				characterCount: 1,
				is_admin: false,
				isBlacklisted: false,
				discordUserId: null,
				discordUsername: null,
			},
			characters: [],
		}
		expect(render(<UserSearchCard user={user} />)).toContain('1 Charakter')
	})

	it('localizes pagination counts and exposes the current page', async () => {
		await setAppLocale('de', { persistLocal: false })
		const html = render(
			<UserSearchPaginationControls
				totalCount={1234}
				page={2}
				pageSize={25}
				onPageChange={vi.fn()}
				onPageSizeChange={vi.fn()}
				itemLabel="Mitglieder"
			/>
		)
		expect(html).toContain('Mitglieder: 26–50 von 1.234')
		expect(html).toContain('Pro Seite:')
		expect(html).toContain('aria-current="page"')
		expect(html).toContain('Weiter')
		await setAppLocale('en', { persistLocal: false })
		expect(
			render(
				<UserSearchPaginationControls
					totalCount={1}
					page={1}
					pageSize={25}
					onPageChange={vi.fn()}
					onPageSizeChange={vi.fn()}
				/>
			)
		).toContain('1–1 of 1 user')
	})

	it('localizes large page numbers and preserves the upstream leading control', async () => {
		await setAppLocale('de', { persistLocal: false })
		const html = render(
			<UserSearchPaginationControls
				totalCount={50000}
				page={1000}
				pageSize={25}
				onPageChange={vi.fn()}
				onPageSizeChange={vi.fn()}
				controlsLeadingAction={<button type="button">Original layout control</button>}
			/>
		)
		expect(html).toMatch(/aria-current="page"[^>]*>1\.000<\/button>/)
		expect(html).toContain('Original layout control')
		expect(html).toContain('Pro Seite:')
	})

	it('keeps export query values unchanged across locales', async () => {
		const query = {
			roleFilter: 'Director' as const,
			authFilter: 'linked_invalid' as const,
			search: 'Pilot Original',
			sortField: 'name' as const,
			sortOrder: 'desc' as const,
		}
		const before = buildCorporationMembersExportUrl('987654321', query)
		await setAppLocale('ko', { persistLocal: false })
		expect(buildCorporationMembersExportUrl('987654321', query)).toBe(before)
		expect(before).toContain('roleFilter=Director')
		expect(before).toContain('authFilter=linked_invalid')
	})

	it('resolves delayed refresh notifications in the active locale and preserves API/cache targets', async () => {
		const client = new QueryClient()
		const invalidate = vi.spyOn(client, 'invalidateQueries')
		const result = {
			success: true,
			message: 'Server response',
			lastUpdated: null,
			hasValidToken: true,
		}
		const refresh = vi.spyOn(api, 'refreshCharacterById').mockResolvedValue(result)
		function Harness() {
			useRefreshCharacter()
			return null
		}
		render(<Harness />, client)
		const options = captured.options as UseApiMutationOptions<
			Awaited<ReturnType<typeof api.refreshCharacterById>>,
			string
		>
		await options.mutationFn('123456789')
		expect(refresh).toHaveBeenCalledWith('123456789')
		await setAppLocale('ko', { persistLocal: false })
		if (typeof options.successMessage !== 'function') throw new Error('Expected lazy feedback')
		expect(options.successMessage(result, '123456789')).toBe('캐릭터 데이터를 업데이트했습니다')
		await options.onSuccess?.(result, '123456789', undefined)
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['character', '123456789'] })
	})
})
