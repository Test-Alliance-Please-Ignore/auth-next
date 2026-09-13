import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { JsonViewer } from '@/components/json-viewer'
import { adminUserKeys } from '@/hooks/useAdminUsers'
import { getActiveLocale, I18nProvider, setAppLocale } from '@/i18n'
import { formatDateTime } from '@/lib/date-utils'
import ActivityLogPage from '@/routes/admin/activity-log'
import BlocklistPage from '@/routes/admin/blacklist'

import { activityEntry, activityPage, blocklistPage } from '../fixtures/admin-blocklist-activity'

import type { ReactNode } from 'react'

const clients: QueryClient[] = []
const blocklistKey = ['blacklists', 1, 50, undefined, undefined, undefined]
const activityKey = adminUserKeys.activityLog({ page: 1, pageSize: 50 })

function createClient() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, retryOnMount: false } },
	})
	clients.push(client)
	client.setQueryData(blocklistKey, blocklistPage)
	client.setQueryData(activityKey, activityPage)
	return client
}

function render(children: ReactNode, client = createClient()) {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MantineProvider>
					<DatesProvider settings={{ locale: getActiveLocale() }}>
						<MemoryRouter>{children}</MemoryRouter>
					</DatesProvider>
				</MantineProvider>
			</I18nProvider>
		</QueryClientProvider>
	)
}

describe('admin blocklist and activity localization', () => {
	afterEach(async () => {
		clients.splice(0).forEach((client) => client.clear())
		await setAppLocale('en', { persistLocal: false })
	})

	it.each([
		['en', 'Blocklist Management', 'Corporation Name', 'Alliance ID', 'Manual', '1,234'],
		['de', 'Sperrliste verwalten', 'Corporation-Name', 'Allianz-ID', 'Manuell', '1.234'],
		['ko', '차단 목록 관리', '코퍼레이션 이름', '얼라이언스 ID', '수동', '1,234'],
	] as const)(
		'renders blocklist targets and counts in %s, preserving identifiers and reasons',
		async (locale, title, corporation, alliance, mode, count) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(<BlocklistPage />)
			for (const text of [
				title,
				corporation,
				alliance,
				mode,
				count,
				'Original reason &lt;detail&gt; {{raw}}',
				'987654321012345678',
			])
				expect(html).toContain(text)
			expect(html).toContain('href="/admin/users/user-original"')
			expect(html).toContain(formatDateTime(blocklistPage.data[0].createdAt))
			expect(html).not.toContain('admin.blocklist.')
			expect(html).not.toContain('<Original>')
		}
	)

	it.each([
		['en', 'Activity Log', 'Character linked', '1,234', 'MM/DD/YYYY'],
		['de', 'Aktivitätsprotokoll', 'Charakter verknüpft', '1.234', 'DD.MM.YYYY'],
		['ko', '활동 로그', '캐릭터 연결됨', '1,234', 'YYYY. MM. DD.'],
	] as const)(
		'renders activity and dates in %s, retaining unknown actions and links',
		async (locale, title, action, count, dateFormat) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(<ActivityLogPage />)
			for (const text of [
				title,
				action,
				count,
				dateFormat,
				'custom.original_action',
				'title="character_linked"',
				'192.0.2.123',
				'Original Agent/1.2',
				'Character &lt;Original&gt;',
				'User &lt;Original&gt;',
			])
				expect(html).toContain(text)
			expect(html).toContain('href="/character/987654321"')
			expect(html).toContain('href="/admin/users/user-original"')
			expect(html).toContain('for="activity-start-date"')
			expect(html).toContain('id="activity-start-date"')
			expect(html).toContain('aria-expanded="false"')
			expect(html).toContain(formatDateTime(activityEntry.createdAt))
			expect(html).not.toContain('admin.activityLog.')
		}
	)

	it.each([
		['en', 'No Blocklist Entries', 'No activity logs found', 'Showing 0–0 of 0 logs'],
		[
			'de',
			'Keine Sperrlisteneinträge',
			'Keine Aktivitätsprotokolle gefunden',
			'0–0 von 0 Protokolleinträgen',
		],
		['ko', '차단 목록 항목 없음', '활동 로그가 없습니다', '로그 0개 중 0–0개 표시'],
	] as const)(
		'renders empty results in %s with a zero-based empty range',
		async (locale, blocklist, activity, range) => {
			await setAppLocale(locale, { persistLocal: false })
			const client = createClient()
			const empty = {
				data: [],
				pagination: { page: 1, pageSize: 50, totalCount: 0, totalPages: 0 },
			}
			client.setQueryData(blocklistKey, empty)
			client.setQueryData(activityKey, empty)
			const html = render(
				<>
					<BlocklistPage />
					<ActivityLogPage />
				</>,
				client
			)
			for (const text of [blocklist, activity, range]) expect(html).toContain(text)
		}
	)

	it.each([
		['en', 'Failed to load blocklist entries', 'Failed to load activity logs'],
		[
			'de',
			'Sperrlisteneinträge konnten nicht geladen werden',
			'Aktivitätsprotokolle konnten nicht geladen werden',
		],
		['ko', '차단 목록 항목을 불러오지 못했습니다', '활동 로그를 불러오지 못했습니다'],
	] as const)(
		'renders fallback errors in %s and preserves server errors',
		async (locale, blocklist, activity) => {
			await setAppLocale(locale, { persistLocal: false })
			const client = createClient()
			client.clear()
			for (const queryKey of [blocklistKey, activityKey])
				await client.prefetchQuery({ queryKey, queryFn: () => Promise.reject('fixture failure') })
			const fallback = render(
				<>
					<BlocklistPage />
					<ActivityLogPage />
				</>,
				client
			)
			expect(fallback).toContain(blocklist)
			expect(fallback).toContain(activity)
			expect(fallback).toContain('role="alert"')
			await client.prefetchQuery({
				queryKey: activityKey,
				queryFn: () => Promise.reject(new Error('Original server <detail>')),
			})
			expect(render(<ActivityLogPage />, client)).toContain('Original server &lt;detail&gt;')
		}
	)

	it.each([
		['en', 'Copy', '1 property', '5 properties', 'No data'],
		['de', 'Kopieren', '1 Eigenschaft', '5 Eigenschaften', 'Keine Daten'],
		['ko', '복사', '속성 1개', '속성 5개', '데이터 없음'],
	] as const)(
		'localizes JSON controls in %s while preserving the JSON values',
		async (locale, copy, singular, plural, empty) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = render(
				<>
					<JsonViewer data={activityEntry.metadata} defaultExpanded />
					<JsonViewer data={{ only: false }} />
					<JsonViewer data={null} />
				</>
			)
			for (const text of [
				copy,
				singular,
				plural,
				empty,
				'originalKey',
				'Original &lt;text&gt; {{raw}}',
				'1234.5',
				'>true<',
				'>null<',
			])
				expect(html).toContain(text)
			expect(html).not.toContain('1.234,5')
			expect(html).not.toContain('common.jsonViewer.')
		}
	)
})
