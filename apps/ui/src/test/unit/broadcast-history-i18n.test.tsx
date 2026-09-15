import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderDiscordContentValue } from '@/components/discord-content-renderer'
import { BroadcastStatusBadge } from '@/features/broadcasts/components/broadcast-status-badge'
import { getBroadcastEditRemaining } from '@/features/broadcasts/message-edit-budget'
import {
	broadcastKeys,
	useAddBroadcastAddendum,
	useDeleteBroadcast,
	useRescindBroadcast,
} from '@/hooks/useBroadcasts'
import { I18nProvider, setAppLocale } from '@/i18n'
import { api, NotFoundError } from '@/lib/api'
import { formatDiscordTimestamp } from '@/lib/discord-time'
import BroadcastDetailPage from '@/routes/broadcast-detail'
import BroadcastsPage from '@/routes/broadcasts'

import { applicant } from '../fixtures/applicant-workflows'
import {
	broadcast,
	broadcastDeliveries,
	broadcastManagePermission,
	broadcastTarget,
	broadcastTemplate,
} from '../fixtures/broadcasts'

import type { ReactNode } from 'react'

const page = vi.hoisted(() => ({ title: '' }))
vi.mock('@/hooks/usePageTitle', () => ({
	usePageTitle: (title: string) => {
		page.title = title
	},
}))
let client: QueryClient
const listKey = broadcastKeys.broadcastsPage(undefined, undefined, true, 25, 0, undefined)
function renderUI(children: ReactNode, path = '/broadcasts') {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route path="/broadcasts/:broadcastId" element={children} />
						<Route path="*" element={children} />
					</Routes>
				</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}
beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date('2026-09-14T11:00:00Z'))
	client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
	client.setQueryData(['auth', 'session'], { authenticated: true, user: applicant })
	client.setQueryData(listKey, {
		rows: [broadcast, { ...broadcast, id: 'draft-original', status: 'draft' }],
		rowCount: 1234,
	})
	client.setQueryData(broadcastKeys.targets(), [broadcastTarget])
	client.setQueryData(broadcastKeys.templatesFiltered(), [broadcastTemplate])
	client.setQueryData(broadcastKeys.broadcast(broadcast.id), broadcast)
	client.setQueryData(broadcastKeys.deliveries(broadcast.id), broadcastDeliveries)
})
afterEach(async () => {
	client.clear()
	vi.restoreAllMocks()
	await setAppLocale('en', { persistLocal: false })
	vi.useRealTimers()
})

describe('member broadcast history and detail localization', () => {
	it.each([
		['en', 'My Broadcasts', 'Draft', 'Sent', '1–25 of 1,234 broadcasts', 'Add addendum'],
		[
			'de',
			'Meine Broadcasts',
			'Entwurf',
			'Gesendet',
			'Broadcasts: 1–25 von 1.234',
			'Nachtrag hinzufügen',
		],
		['ko', '내 방송', '초안', '전송됨', '방송 1,234 · 1–25', '추가 내용 덧붙이기'],
	] as const)(
		'renders list and canonical routes in %s',
		async (locale, title, draft, sent, range, addendum) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<BroadcastsPage />)
			for (const text of [
				title,
				draft,
				sent,
				range,
				addendum,
				'Original &lt;Target&gt;',
				'Original &lt;Template&gt;',
			])
				expect(html).toContain(text)
			expect(page.title).toBe(title)
			expect(html).toContain('href="/broadcasts/broadcast-original"')
			expect(html).not.toContain('broadcasts.status.')
			expect(html.match(/<table/g)).toHaveLength(1)
		}
	)
	it.each([
		['en', 'Broadcast Details', 'Delivery attempts for this broadcast', 'September', '1 hour ago'],
		[
			'de',
			'Broadcast-Details',
			'Zustellversuche für diesen Broadcast',
			'September',
			'vor 1 Stunde',
		],
		['ko', '방송 상세 정보', '이 방송의 전달 시도 기록', '9월', '1시간 전'],
	] as const)(
		'renders details and Discord timestamp previews in %s',
		async (locale, title, deliveries, month, relative) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<BroadcastDetailPage />, `/broadcasts/${broadcast.id}`)
			for (const text of [
				title,
				deliveries,
				month,
				relative,
				'Original &lt;Broadcast&gt;',
				'Original &lt;delivery error&gt;',
				'OriginalMissingTarget',
				'&lt;script&gt;raw&lt;/script&gt;',
			])
				expect(html).toContain(text)
			expect(html).toContain('<strong>message</strong>')
			expect(html).not.toContain('<script>')
			expect(broadcast.content.message).toContain('<t:1789380000:F>')
		}
	)
	it('keeps unknown statuses visible and checks owner/manager action boundaries', async () => {
		await setAppLocale('de', { persistLocal: false })
		expect(renderUI(<BroadcastStatusBadge status="constructor" />)).toContain('>constructor</div>')
		let html = renderUI(<BroadcastsPage />)
		expect(html).toContain('aria-label="Broadcast zurücknehmen"')
		expect(html).not.toContain('aria-label="Broadcast löschen"')
		client.setQueryData(['auth', 'session'], {
			authenticated: true,
			user: { ...applicant, id: 'other-user' },
		})
		html = renderUI(<BroadcastsPage />)
		expect(html).not.toContain('aria-label="Broadcast zurücknehmen"')
		client.setQueryData(['auth', 'session'], {
			authenticated: true,
			user: { ...applicant, id: 'other-user' },
			permissions: [broadcastManagePermission],
		})
		html = renderUI(<BroadcastsPage />)
		expect(html).toContain('aria-label="Broadcast zurücknehmen"')
		expect(html).toContain('aria-label="Broadcast löschen"')
	})
	it('shows loading, empty and request failures distinctly', async () => {
		await setAppLocale('ko', { persistLocal: false })
		client.removeQueries({ queryKey: listKey })
		expect(renderUI(<BroadcastsPage />)).toContain('불러오는 중…')
		await client.prefetchQuery({ queryKey: listKey, queryFn: () => Promise.reject('fallback') })
		const failed = renderUI(<BroadcastsPage />)
		expect(failed).toContain('방송을 불러오지 못했습니다.')
		expect(failed).not.toContain('첫 방송 만들기')
		client.setQueryData(listKey, { rows: [], rowCount: 0 })
		expect(renderUI(<BroadcastsPage />)).toContain('첫 방송 만들기')
		client.removeQueries({ queryKey: broadcastKeys.broadcast(broadcast.id), exact: true })
		await client.prefetchQuery({
			queryKey: broadcastKeys.broadcast(broadcast.id),
			queryFn: () => Promise.reject(new NotFoundError('Original missing')),
		})
		expect(renderUI(<BroadcastDetailPage />, `/broadcasts/${broadcast.id}`)).toContain(
			'방송을 찾을 수 없습니다'
		)
		client.setQueryData(broadcastKeys.broadcast(broadcast.id), broadcast)
		client.removeQueries({ queryKey: broadcastKeys.deliveries(broadcast.id) })
		await client.prefetchQuery({
			queryKey: broadcastKeys.deliveries(broadcast.id),
			queryFn: () => Promise.reject('fallback'),
		})
		expect(renderUI(<BroadcastDetailPage />, `/broadcasts/${broadcast.id}`)).toContain(
			'전달 기록을 불러오지 못했습니다.'
		)
	})
})

describe('broadcast Discord edit budgets', () => {
	const sentFooter = '#### SENT BY Original <Pilot> to Original <Target> @ <t:1789380000:F> ####'
	const eventFooter = '#### ADDENDUM BY Original <Pilot> @ <t:1789383600:F> ####'
	it.each(['en', 'de', 'ko'] as const)(
		'counts canonical addendum metadata and exact boundaries in %s',
		async (locale) => {
			await setAppLocale(locale, { persistLocal: false })
			const value = { ...broadcast, content: { __baseMessage: 'Original message' } }
			const prefix = `Original message\n\n${sentFooter}\n\nADDENDUM: `
			const suffix = `\n\n${eventFooter}`
			const budget = 2000 - prefix.length - suffix.length
			expect(getBroadcastEditRemaining(value, 'addendum', 'x'.repeat(budget))).toBe(0)
			expect(getBroadcastEditRemaining(value, 'addendum', 'x'.repeat(budget + 1))).toBe(-1)
			expect(getBroadcastEditRemaining(value, 'addendum', ' x ')).toBe(budget - 1)
		}
	)
	it('includes strikethrough and optional rescind prefixes plus previous events', () => {
		const value = {
			...broadcast,
			content: {
				__baseMessage: 'First\n\nSecond',
				__messageEvents: [
					{
						type: 'addendum',
						message: 'Original addendum',
						createdAtUnix: 1789380001,
						createdByCharacterName: 'Original <Pilot>',
					},
				],
			},
		}
		const base = `~~First~~\n\n~~Second~~\n\n${sentFooter}\n\nADDENDUM: Original addendum\n\n#### ADDENDUM BY Original <Pilot> @ <t:1789380001:F> ####\n\n`
		const footer = '#### RESCINDED @ <t:1789383600:F> ####'
		expect(getBroadcastEditRemaining(value, 'rescind', '')).toBe(2000 - (base + footer).length)
		expect(getBroadcastEditRemaining(value, 'rescind', ' raw reason ')).toBe(
			2000 - (base + 'RESCINDED: raw reason\n\n' + footer).length
		)
	})
	it('preserves existing sent-message text while stripping the canonical footer for counting', () => {
		const message = `Original <t:1789380000:F>\n\n${sentFooter}`
		const value = { ...broadcast, content: { message } }
		const composed = `Original <t:1789380000:F>\n\n${sentFooter}\n\nADDENDUM: Extra\n\n${eventFooter}`
		expect(getBroadcastEditRemaining(value, 'addendum', 'Extra')).toBe(2000 - composed.length)
		expect(value.content.message).toBe(message)
	})
})

describe('Discord timestamp display', () => {
	it.each([
		['en', '09/14/2026', 'September 14, 2026'],
		['de', '14.09.2026', '14. September 2026'],
		['ko', '2026. 09. 14.', '2026년 9월 14일'],
	] as const)(
		'formats all timestamp styles in %s without altering inline code',
		async (locale, short, long) => {
			await setAppLocale(locale, { persistLocal: false })
			const date = new Date('2026-09-14T10:00:00Z')
			expect(formatDiscordTimestamp(date, 'd')).toBe(short)
			expect(formatDiscordTimestamp(date, 'D')).toBe(long)
			for (const style of ['t', 'T', 'f', 'F', 'R'])
				expect(formatDiscordTimestamp(date, style)).not.toContain('Invalid')
			const html = renderToStaticMarkup(
				<>
					{renderDiscordContentValue(
						'`<t:1789380000:F>` <t:999999999999999999999999:F>',
						'timestamp'
					)}
				</>
			)
			expect(html).toContain('&lt;t:1789380000:F&gt;</code>')
			expect(html).toContain('&lt;t:999999999999999999999999:F&gt;')
		}
	)
})

describe('broadcast action cache refresh', () => {
	it.each(['addendum', 'rescind', 'delete'] as const)(
		'refreshes cached details after %s from the list',
		async (action) => {
			vi.spyOn(api, 'addBroadcastAddendum').mockResolvedValue({ success: true })
			vi.spyOn(api, 'rescindBroadcast').mockResolvedValue({ success: true })
			vi.spyOn(api, 'deleteBroadcast').mockResolvedValue({ success: true })
			let mutate: () => Promise<unknown> = async () => {
				throw new Error('Harness not rendered')
			}
			function Harness() {
				const addendum = useAddBroadcastAddendum()
				const rescind = useRescindBroadcast()
				const remove = useDeleteBroadcast()
				mutate =
					action === 'addendum'
						? () => addendum.mutateAsync({ id: broadcast.id, addendumMessage: 'Original text' })
						: action === 'rescind'
							? () => rescind.mutateAsync({ id: broadcast.id, rescindMessage: 'Original reason' })
							: () => remove.mutateAsync(broadcast.id)
				return null
			}
			client.setQueryData(broadcastKeys.broadcast('unrelated'), { ...broadcast, id: 'unrelated' })
			renderUI(<Harness />)
			expect(client.getQueryState(broadcastKeys.broadcast(broadcast.id))?.isInvalidated).toBe(false)
			await mutate()
			expect(client.getQueryState(listKey)?.isInvalidated).toBe(true)
			expect(client.getQueryState(broadcastKeys.broadcast(broadcast.id))?.isInvalidated).toBe(true)
			expect(client.getQueryState(broadcastKeys.deliveries(broadcast.id))?.isInvalidated).toBe(true)
			expect(client.getQueryState(broadcastKeys.broadcast('unrelated'))?.isInvalidated).toBe(false)
		}
	)
})
