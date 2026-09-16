import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { Trans } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { InventoryBaysTable } from '@/components/inventory-bays-table'
import { IpHashInspectionPage } from '@/components/ip-hash-inspection-page'
import { IpHistoryCard } from '@/components/ip-history-card'
import { JsonViewer } from '@/components/json-viewer'
import { StructureStateBadge } from '@/components/structure-state-badge'
import { TotalTaxesReportGrid } from '@/components/tax-reports/grids/total-taxes-report-grid'
import { UserSearchResultsTable } from '@/components/user-search-results-table'
import { NotificationsSection } from '@/features/applications/components/report-sections/notifications-section'
import { formatCorporationRoleLabel } from '@/features/corporations/hooks'
import { SessionStatusPill } from '@/features/fleet-tracking/components/session-status-pill'
import { SERVICE_TYPE_LABELS } from '@/features/industry/types'
import { ScanStatusBadge } from '@/features/moon-scan/components/ScanStatusBadge'
import { SkillPlanCard } from '@/features/skill-plans/components/skill-plan-card'
import { i18n, I18nProvider, setAppLocale } from '@/i18n'
import { formatStructureLabel } from '@/lib/structure-labels'
import { getTaxRefTypeOptions } from '@/lib/tax-display'

import type { ReactNode } from 'react'
import type { SkillPlan } from '@/features/skill-plans/types'
import type { AppLocale } from '@/i18n'

function renderUI(children: ReactNode) {
	return renderToStaticMarkup(
		<I18nProvider>
			<QueryClientProvider client={new QueryClient()}>
				<MantineProvider>
					<MemoryRouter>{children}</MemoryRouter>
				</MantineProvider>
			</QueryClientProvider>
		</I18nProvider>
	)
}

afterEach(async () => {
	await setAppLocale('en', { persistLocal: false })
})

describe('German and Korean user pages', () => {
	const user = {
		id: 'user-123456789',
		mainCharacterId: '123',
		mainCharacterName: 'Pilot <original>',
		characterCount: 1,
		is_admin: true,
		discordUserId: 'discord-123',
		discordUsername: null,
		matchedCharacterId: null,
		matchedCharacterName: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-02T00:00:00Z',
	}

	it.each([
		{
			locale: 'de',
			header: 'Zuletzt aktualisiert',
			linked: 'Discord verknüpft',
			counts: ['0 Charaktere', '1 Charakter', '2 Charaktere'],
		},
		{
			locale: 'ko',
			header: '마지막 업데이트',
			linked: 'Discord 연결됨',
			counts: ['0개 캐릭터', '1개 캐릭터', '2개 캐릭터'],
		},
	] as const)(
		'renders HR search results and character counts in $locale',
		async ({ locale, header, linked, counts }) => {
			await setAppLocale(locale, { persistLocal: false })
			for (const count of [0, 1, 2]) {
				const html = renderUI(
					<UserSearchResultsTable
						users={[{ ...user, characterCount: count }]}
						userDetailsPath={(id) => `/hr/users/${id}`}
						onRefreshDiscordAccess={() => {}}
					/>
				)
				expect(html).toContain(header)
				expect(html).toContain(linked)
				expect(html).toContain(counts[count])
				expect(html).toContain('Pilot &lt;original&gt;')
				expect(html).toContain('href="/hr/users/user-123456789"')
				expect(html).not.toContain('Refresh Discord roles')
				expect(html).not.toContain('Last Updated')
			}
		}
	)

	it.each([
		{
			locale: 'en',
			counts: ['0 additional matches', '1 additional match', '2 additional matches'],
		},
		{
			locale: 'de',
			counts: [
				'0 weitere Übereinstimmungen',
				'1 weitere Übereinstimmung',
				'2 weitere Übereinstimmungen',
			],
		},
		{ locale: 'ko', counts: ['추가 일치 0건', '추가 일치 1건', '추가 일치 2건'] },
		{
			locale: 'es-MX',
			counts: [
				'0 coincidencias adicionales',
				'1 coincidencia adicional',
				'2 coincidencias adicionales',
			],
		},
	] as const)(
		'renders IP match counts in $locale without English suffixes',
		async ({ locale, counts }) => {
			await setAppLocale(locale, { persistLocal: false })
			for (const count of [0, 1, 2]) {
				const html = renderUI(
					<IpHistoryCard
						title="IP"
						entries={[
							{
								ipAddressHash: 'hash-123',
								firstSeenAt: user.createdAt,
								lastSeenAt: user.updatedAt,
								seenCount: 2,
								distinctUserCount: count + 1,
							},
						]}
						buildHashInspectionLink={(hash) => `/hr/ip/${hash}`}
					/>
				)
				expect(html).toContain(counts[count])
				expect(html.includes('href="/hr/ip/hash-123"')).toBe(count > 0)
				if (locale !== 'en') {
					expect(html).not.toContain('First seen')
					expect(html).not.toContain('Last seen')
					expect(html).not.toContain('Click to expand')
				}
			}
		}
	)

	it.each([
		{
			locale: 'de',
			empty: 'Keine Benutzer für diesen Hash gefunden.',
			loading: 'Übereinstimmungen werden geladen...',
			noHistory: 'Kein IP-Verlauf gefunden.',
		},
		{
			locale: 'ko',
			empty: '이 해시에 해당하는 사용자가 없습니다.',
			loading: '일치 항목 불러오는 중...',
			noHistory: 'IP 이력이 없습니다.',
		},
	] as const)(
		'translates IP inspection loading and empty states in $locale',
		async ({ locale, empty, loading, noHistory }) => {
			await setAppLocale(locale, { persistLocal: false })
			const props = {
				hash: 'hash-123',
				matches: [],
				backTo: '/hr/users',
				backLabel: 'Back',
				buildUserLink: (id: string) => `/hr/users/${id}`,
				loadUserHashes: async () => ({ entries: [] }),
				buildHashLink: (hash: string) => `/hr/ip/${hash}`,
			}
			expect(renderUI(<IpHashInspectionPage {...props} isLoading />)).toContain(loading)
			expect(renderUI(<IpHashInspectionPage {...props} isLoading={false} />)).toContain(empty)
			expect(
				renderUI(
					<IpHistoryCard title="IP" entries={[]} buildHashInspectionLink={props.buildHashLink} />
				)
			).toContain(noHistory)
		}
	)

	it('updates report notification labels and corporation roles when switching locales', async () => {
		const data = [
			{
				notification_id: 'notice-1',
				type: 'CorpKicked',
				senderName: 'Original sender',
				timestamp: user.createdAt,
			},
		]
		const cases: Array<{
			locale: AppLocale
			notification: string
			director: string
			member: string
		}> = [
			{
				locale: 'de',
				notification: 'Aus Corporation entfernt',
				director: 'Direktor',
				member: 'Mitglied',
			},
			{ locale: 'ko', notification: '코퍼레이션에서 추방됨', director: '이사', member: '멤버' },
			{ locale: 'en', notification: 'Corp Kicked', director: 'Director', member: 'Member' },
		]
		for (const { locale, notification, director, member } of cases) {
			await setAppLocale(locale, { persistLocal: false })
			expect(
				renderUI(<NotificationsSection data={{ notifications: data, types: ['CorpKicked'] }} />)
			).toContain(notification)
			expect(formatCorporationRoleLabel('Director')).toBe(director)
			expect(formatCorporationRoleLabel('Member')).toBe(member)
			expect(data[0].type).toBe('CorpKicked')
		}
	})

	it.each(['de', 'ko'] as const)(
		'keeps applicant names and JSON data intact in %s',
		async (locale) => {
			await setAppLocale(locale, { persistLocal: false })
			const confirmation = renderUI(
				<Trans
					i18nKey="hrpages.confirmCompleteApplication"
					values={{ character: 'Pilot & Name' }}
					components={{ strong: <strong /> }}
				/>
			)
			expect(confirmation).toContain('<strong>Pilot &amp; Name</strong>')
			expect(confirmation).not.toContain('{{character}}')
			expect(confirmation).not.toContain('Are you sure')
			const html = renderUI(<JsonViewer data={{ originalKey: 'Original value' }} defaultExpanded />)
			expect(html).toContain('originalKey')
			expect(html).toContain('Original value')
			expect(html).not.toContain('property')
			expect(html).not.toContain('>Copy<')
		}
	)
})

describe('Spanish user pages', () => {
	it('translates tax report columns and the empty result message', async () => {
		await setAppLocale('es-MX', { persistLocal: false })
		const html = renderUI(
			<TotalTaxesReportGrid
				rows={[]}
				loading={false}
				error={null}
				entityNames={{}}
				sorting={[]}
				onSortingChange={() => {}}
				pagination={{ pageIndex: 0, pageSize: 25 }}
				onPaginationChange={() => {}}
				rowCount={0}
			/>
		)
		expect(html).toContain('Conceptos gravables')
		expect(html).toContain('Impuesto por pagar')
		expect(html).toContain('No se encontraron totales.')
		expect(html).not.toContain('Taxable Items')
	})

	it('resolves default inventory copy and status badges in Spanish', async () => {
		await setAppLocale('es-MX', { persistLocal: false })
		const html = renderUI(
			<>
				<InventoryBaysTable bays={[]} />
				<StructureStateBadge state="armor_reinforce" />
				<SessionStatusPill status="ended" />
				<ScanStatusBadge status="pending" />
			</>
		)
		expect(html).toContain('No hay inventario registrado para esta estructura.')
		expect(html).toContain('Reforzada (blindaje)')
		expect(html).toContain('Pendiente')
		expect(html).not.toContain('Ended')
		expect(html).not.toContain('Pending')
	})

	it.each([0, 1, 2])(
		'renders a skill plan with %s skills and preserves its authored name',
		async (count) => {
			await setAppLocale('es-MX', { persistLocal: false })
			const plan: SkillPlan = {
				id: 'plan-1',
				name: 'Original plan <keep>',
				description: 'Player-authored description',
				isPublished: true,
				maintainerId: null,
				ownerCharacterId: null,
				createdAt: '2026-01-01T00:00:00Z',
				updatedAt: '2026-01-01T00:00:00Z',
				skills: Array.from({ length: count }, (_, index) => ({
					skillId: String(index),
					skillName: 'Gunnery',
					skillGroup: 'Gunnery',
					requiredLevel: 1,
					recommendedLevel: 3,
					addedAt: '2026-01-01T00:00:00Z',
				})),
			}
			const html = renderUI(<SkillPlanCard plan={plan} />)
			expect(html).toContain(`${count} ${count === 1 ? 'habilidad' : 'habilidades'} en este plan`)
			expect(html).toContain('Original plan &lt;keep&gt;')
			expect(html).toContain('Player-authored description')
		}
	)

	it('refreshes display labels after switching languages without changing filter values', async () => {
		await setAppLocale('en', { persistLocal: false })
		const english = getTaxRefTypeOptions()
		expect(SERVICE_TYPE_LABELS.general_manufacturing).toBe('General Manufacturing')
		expect(formatStructureLabel('sovereignty')).toBe('Sovereignty')

		await setAppLocale('es-MX', { persistLocal: false })
		const spanish = getTaxRefTypeOptions()
		expect(spanish.map((option) => option.value)).toEqual(english.map((option) => option.value))
		expect(spanish.map((option) => option.label)).not.toEqual(english.map((option) => option.label))
		expect(SERVICE_TYPE_LABELS.general_manufacturing).toBe('Manufactura general')
		expect(formatStructureLabel('sovereignty')).toBe('Soberanía')
	})

	it('uses complete plural messages for fleet actions and scan confirmations', async () => {
		await setAppLocale('es-MX', { persistLocal: false })
		expect(i18n.t('fleetTracking.removedMembers', { count: 1 })).toBe(
			'Se quitó 1 miembro de la flota.'
		)
		expect(i18n.t('fleetTracking.removedMembers', { count: 2 })).toBe(
			'Se quitaron 2 miembros de la flota.'
		)
		expect(i18n.t('moonScan.approvedPendingScans', { count: 1 })).toBe(
			'Se aprobó 1 escaneo pendiente.'
		)
		expect(i18n.t('moonScan.approvedPendingScans', { count: 1_000_000 })).toBe(
			'Se aprobaron 1000000 escaneos pendientes.'
		)
	})
})
