import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applicationsApi } from '@/features/applications/api'
import { AccessDeniedCard } from '@/features/applications/components/access-denied-card'
import { ApplicationTimeline } from '@/features/applications/components/application-timeline'
import { MessageItem } from '@/features/applications/components/message-item'
import { MessagesPanel } from '@/features/applications/components/messages-panel'
import {
	applicationKeys,
	useAddApplicationAlt,
	useRemoveApplicationAlt,
	useWithdrawApplication,
} from '@/features/applications/hooks'
import ApplicationDetail from '@/features/applications/routes/application-detail'
import { corporationKeys } from '@/features/corporations/hooks'
import { hrKeys } from '@/features/hr/hooks'
import { I18nProvider, setAppLocale } from '@/i18n'

import {
	activity,
	corporationAccess,
	detailApplicant,
	detailedApplication,
	messages,
} from '../fixtures/applicant-details'

import type { ReactNode } from 'react'

const page = vi.hoisted(() => ({ title: '' }))
vi.mock('@/hooks/usePageTitle', () => ({
	usePageTitle: (title: string) => {
		page.title = title
	},
}))

let client: QueryClient
function renderUI(children: ReactNode) {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MemoryRouter initialEntries={['/my-applications/application-original']}>
					<Routes>
						<Route path="/my-applications/:applicationId" element={children} />
					</Routes>
				</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}

const detailKey = applicationKeys.detail(detailedApplication.id)
const permissionKey = [
	...hrKeys.permission(detailedApplication.corporationId),
	detailApplicant.id,
	null,
]

describe('applicant details, history, and messaging localization', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-09-14T06:00:00Z'))
		client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
		client.setQueryData(['auth', 'session'], { authenticated: true, user: detailApplicant })
		client.setQueryData(detailKey, detailedApplication)
		client.setQueryData(
			[
				...corporationKeys.accessForCorporation(detailedApplication.corporationId),
				detailApplicant.id,
			],
			corporationAccess
		)
		client.setQueryData(permissionKey, { hasPermission: false, currentRole: null })
		client.setQueryData(applicationKeys.messages(detailedApplication.id), messages)
	})
	afterEach(async () => {
		client.clear()
		await setAppLocale('en', { persistLocal: false })
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	it.each([
		[
			'en',
			'Application to Original <Corporation>',
			'Application Text',
			'Withdraw Application',
			'Remove Alt &lt;Pilot&gt;',
		],
		[
			'de',
			'Bewerbung bei Original <Corporation>',
			'Bewerbungstext',
			'Bewerbung zurückziehen',
			'Alt &lt;Pilot&gt; entfernen',
		],
		['ko', 'Original <Corporation> 지원서', '지원 내용', '지원서 철회', 'Alt &lt;Pilot&gt; 삭제'],
	] as const)(
		'renders applicant details and accessible alt controls in %s',
		async (locale, title, text, withdraw, remove) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<ApplicationDetail />)
			expect(page.title).toBe(title)
			expect(html).toContain(text)
			expect(html).toContain(withdraw)
			expect(html).toContain(`aria-label="${remove}"`)
			expect(html).toContain('Original &lt;application&gt; text — 지원 내용')
			expect(html).toContain('href="/my-applications"')
		}
	)

	it.each(['accepted', 'completed', 'rejected', 'withdrawn'] as const)(
		'keeps %s applications closed for alt changes and withdrawal',
		async (status) => {
			await setAppLocale('de', { persistLocal: false })
			client.setQueryData(detailKey, {
				...detailedApplication,
				status,
				reviewedAt: '2026-09-14T04:00:00Z',
				reviewedByCharacterName: 'Reviewer <Pilot>',
				reviewNotes: 'Original <review> text',
			})
			const html = renderUI(<ApplicationDetail />)
			expect(html).not.toContain('Bewerbung zurückziehen')
			expect(html).not.toContain('aria-label="Alt &lt;Pilot&gt; entfernen"')
			expect(html).not.toContain('Alt hinzufügen')
			if (status === 'accepted' || status === 'rejected') {
				expect(html).toContain('Informationen zur Prüfung')
				expect(html).toContain('Reviewer &lt;Pilot&gt;')
				expect(html).toContain('Original &lt;review&gt; text')
				expect(html).toContain('vor 2 Stunden')
			}
		}
	)

	it('preserves owner, HR redirect, and signed-out access gates', async () => {
		await setAppLocale('ko', { persistLocal: false })
		client.setQueryData(detailKey, { ...detailedApplication, userId: 'another-user' })
		const denied = renderUI(<ApplicationDetail />)
		expect(denied).toContain('접근 거부')
		expect(denied).toContain('이 지원서를 볼 권한이 없습니다.')
		expect(denied).not.toContain('Original &lt;application&gt; text')
		client.setQueryData(permissionKey, { hasPermission: true, currentRole: 'hr_viewer' })
		expect(renderUI(<ApplicationDetail />)).toBe('')
		client.setQueryData(['auth', 'session'], { authenticated: false, user: null })
		expect(renderUI(<ApplicationDetail />)).toBe('')
	})

	it('translates unavailable-resource defaults but preserves caller-supplied text', async () => {
		await setAppLocale('de', { persistLocal: false })
		expect(renderUI(<AccessDeniedCard />)).toContain('Zugriff verweigert')
		expect(
			renderUI(
				<AccessDeniedCard
					title="Original title"
					message="Original <detail>"
					backLabel="Original back"
					backHref="/unchanged"
				/>
			)
		).toContain('Original &lt;detail&gt;')
		client.removeQueries({ queryKey: detailKey })
		await client.prefetchQuery({
			queryKey: detailKey,
			queryFn: () => Promise.reject('fixture failure'),
		})
		const fallback = renderUI(<ApplicationDetail />)
		expect(fallback).toContain('Bewerbung konnte nicht geladen werden')
		expect(fallback).toContain('Ein unerwarteter Fehler ist aufgetreten')
		await client.prefetchQuery({
			queryKey: detailKey,
			queryFn: () => Promise.reject(new Error('Original <error>')),
		})
		expect(renderUI(<ApplicationDetail />)).toContain('Original &lt;error&gt;')
	})

	it.each([
		[
			'en',
			'Application Submitted',
			'Status: Under Review',
			'Changed from Pending to Under Review',
			'Alt Character Added',
			'By Reviewer &lt;Pilot&gt;',
		],
		[
			'de',
			'Bewerbung eingereicht',
			'Status: In Prüfung',
			'Von Ausstehend zu In Prüfung geändert',
			'Alt-Charakter hinzugefügt',
			'Von Reviewer &lt;Pilot&gt;',
		],
		[
			'ko',
			'지원서 제출됨',
			'상태: 검토 중',
			'대기 중에서 검토 중(으)로 변경',
			'부캐릭터 추가됨',
			'수행자: Reviewer &lt;Pilot&gt;',
		],
	] as const)(
		'translates server timeline actions and preserves actor names in %s',
		async (locale, submitted, status, change, alt, actor) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<ApplicationTimeline activityLog={activity} />)
			for (const text of [submitted, status, change, alt, actor, 'Original &lt;review&gt; text'])
				expect(html).toContain(text)
			expect(html.indexOf(alt)).toBeLessThan(html.indexOf(submitted))
			expect(activity[0].id).toBe('submitted-event')
			expect(html).toContain('dateTime="2026-09-14T04:00:00Z"')
		}
	)

	it('handles future status/action codes without labeling them pending and excludes messages', async () => {
		await setAppLocale('de', { persistLocal: false })
		const html = renderUI(
			<ApplicationTimeline
				showActors={false}
				activityLog={[
					{
						...activity[1],
						id: 'future',
						newValue: 'future_status',
						previousValue: 'future_previous',
					},
					{ ...activity[0], action: 'constructor' },
				]}
			/>
		)
		expect(html).toContain('Status: future_status')
		expect(html).toContain('Von future_previous zu future_status geändert')
		expect(html).toContain('Aktivität: constructor')
		expect(html).not.toContain('Reviewer')
		expect(html).not.toContain('Ausstehend')
		expect(
			renderUI(<ApplicationTimeline activityLog={[{ ...activity[0], action: 'message_sent' }]} />)
		).toContain('Noch keine Aktivitäten aufgezeichnet')
	})

	it.each([
		['en', 'You', '2 hours ago', 'Send Message', 'This application is closed.'],
		['de', 'Du', 'vor 2 Stunden', 'Nachricht senden', 'Diese Bewerbung ist geschlossen.'],
		['ko', '나', '2시간 전', '메시지 보내기', '이 지원서는 마감되어'],
	] as const)(
		'translates conversation controls and keeps message bodies in %s',
		async (locale, you, time, send, closed) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(
				<MessagesPanel
					applicationId={detailedApplication.id}
					currentUserId={detailApplicant.id}
					canSend
				/>
			)
			for (const text of [
				you,
				time,
				send,
				'Original sent &lt;message&gt; — 안녕하세요',
				'Reviewer &lt;Pilot&gt;',
			])
				expect(html).toContain(text)
			expect(html).toContain('maxLength="2000"')
			expect(html).toContain('disabled=""')
			const locked = renderUI(
				<MessagesPanel
					applicationId={detailedApplication.id}
					currentUserId={detailApplicant.id}
					canSend={false}
				/>
			)
			expect(locked).toContain(closed)
			expect(locked).not.toContain('<textarea')
			expect(locked).not.toContain(send)
		}
	)

	it('translates unknown senders and message loading/failure/empty states', async () => {
		await setAppLocale('ko', { persistLocal: false })
		expect(
			renderUI(
				<MessageItem
					message={{ ...messages[0], senderCharacterName: null }}
					currentUserId={detailApplicant.id}
				/>
			)
		).toContain('알 수 없음')
		client.setQueryData(applicationKeys.messages(detailedApplication.id), [])
		expect(
			renderUI(
				<MessagesPanel
					applicationId={detailedApplication.id}
					currentUserId={detailApplicant.id}
					canSend
				/>
			)
		).toContain('대화를 시작해 보세요!')
		client.removeQueries({ queryKey: applicationKeys.messages(detailedApplication.id) })
		expect(
			renderUI(
				<MessagesPanel
					applicationId={detailedApplication.id}
					currentUserId={detailApplicant.id}
					canSend
				/>
			)
		).toContain('불러오는 중')
		await client.prefetchQuery({
			queryKey: applicationKeys.messages(detailedApplication.id),
			queryFn: () => Promise.reject('fixture failure'),
		})
		expect(
			renderUI(
				<MessagesPanel
					applicationId={detailedApplication.id}
					currentUserId={detailApplicant.id}
					canSend
				/>
			)
		).toContain('메시지를 불러오지 못했습니다')
	})

	it('refreshes cached applicant lists after withdrawal and alt changes using the real hooks', async () => {
		const captured: {
			withdraw?: ReturnType<typeof useWithdrawApplication>
			add?: ReturnType<typeof useAddApplicationAlt>
			remove?: ReturnType<typeof useRemoveApplicationAlt>
		} = {}
		function Harness() {
			captured.withdraw = useWithdrawApplication()
			captured.add = useAddApplicationAlt()
			captured.remove = useRemoveApplicationAlt()
			return null
		}
		renderUI(<Harness />)
		if (!captured.withdraw || !captured.add || !captured.remove)
			throw new Error('Hooks did not render')
		vi.spyOn(applicationsApi, 'withdrawApplication').mockResolvedValue({ success: true })
		const add = vi.spyOn(applicationsApi, 'addApplicationAlts').mockResolvedValue({ success: true })
		const remove = vi
			.spyOn(applicationsApi, 'removeApplicationAlt')
			.mockResolvedValue({ success: true })
		for (const mutate of [
			() => captured.withdraw!.mutateAsync(detailedApplication.id),
			() =>
				captured.add!.mutateAsync({
					applicationId: detailedApplication.id,
					alts: [{ characterId: '345678912', characterName: 'Extra <Alt>' }],
				}),
			() =>
				captured.remove!.mutateAsync({
					applicationId: detailedApplication.id,
					altCharacterId: '234567891',
				}),
		]) {
			client.setQueryData(['applications', 'mine'], [detailedApplication])
			expect(client.getQueryState(['applications', 'mine'])?.isInvalidated).toBe(false)
			await mutate()
			expect(client.getQueryState(['applications', 'mine'])?.isInvalidated).toBe(true)
		}
		expect(add).toHaveBeenCalledExactlyOnceWith(detailedApplication.id, ['345678912'])
		expect(remove).toHaveBeenCalledExactlyOnceWith(detailedApplication.id, '234567891')
	})
})
