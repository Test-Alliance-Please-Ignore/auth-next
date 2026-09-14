import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	buildMumbleUrl,
	OneTimeCredentialsCard,
} from '@/features/mumble/components/credentials-card'
import { TempopSection } from '@/features/mumble/components/tempop-section'
import { mumbleKeys } from '@/features/mumble/query-keys'
import { I18nProvider, setAppLocale } from '@/i18n'
import MumblePage from '@/routes/mumble'
import TempopGuestPage from '@/routes/tempop-guest'

import { mumbleAccount, mumbleCredentials, mumbleMember, tempopList } from '../fixtures/mumble'

import type { ReactNode } from 'react'

const page = vi.hoisted(() => ({ title: '' }))
vi.mock('@/hooks/usePageTitle', () => ({
	usePageTitle: (title: string) => {
		page.title = title
	},
}))
let client: QueryClient
function renderUI(children: ReactNode, path = '/mumble') {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route path="/tempop/:key" element={children} />
						<Route path="*" element={children} />
					</Routes>
				</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}
const listKey = mumbleKeys.tempopList({ status: 'active', page: 1, pageSize: 25 })
describe('member Mumble and temp-op localization', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
		client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
		client.setQueryData(['auth', 'session'], { authenticated: true, user: mumbleMember })
		client.setQueryData(['feature-flags'], { 'mumble.enabled': true })
		client.setQueryData(mumbleKeys.account(), {
			account: mumbleAccount,
			connection: mumbleCredentials.connection,
		})
		client.setQueryData(listKey, tempopList)
	})
	afterEach(async () => {
		client.clear()
		await setAppLocale('en', { persistLocal: false })
		vi.useRealTimers()
	})
	it.each([
		[
			'en',
			'Synced groups',
			'Active',
			'Your Mumble credentials',
			'Copy Password',
			'Connect in Mumble',
		],
		[
			'de',
			'Synchronisierte Gruppen',
			'Aktiv',
			'Deine Mumble-Zugangsdaten',
			'Passwort kopieren',
			'Mit Mumble verbinden',
		],
		['ko', '동기화된 그룹', '활성', '내 Mumble 접속 정보', '비밀번호 복사', 'Mumble로 연결'],
	] as const)(
		'renders account and credentials in %s without changing connection fields',
		async (locale, groups, active, title, copy, connect) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<MumblePage />)
			for (const value of [
				groups,
				active,
				'Original &lt;Pilot&gt;',
				'Original &lt;Group&gt;',
				'voice.example.test:64738',
			])
				expect(html).toContain(value)
			expect(html).not.toContain('tempop-status')
			const credentials = renderUI(<OneTimeCredentialsCard credentials={mumbleCredentials} />)
			for (const value of [title, copy, connect, 'Fixture/@:? &amp;비밀', '64738'])
				expect(credentials).toContain(value)
			expect(credentials).toContain(`href="${buildMumbleUrl(mumbleCredentials)}"`)
			expect(credentials).not.toContain('64.738')
		}
	)
	it.each([
		[
			'en',
			'Create a temp-op link',
			'All creators',
			'2h 30m left',
			'1,234',
			'Short Code',
			'Per page:',
			'1–25 of 30 temp-ops',
		],
		[
			'de',
			'Temp-Op-Link erstellen',
			'Alle Ersteller',
			'Noch 2 Std. 30 Min.',
			'1.234',
			'Kurzcode',
			'Pro Seite:',
			'Temp-Ops: 1–25 von 30',
		],
		[
			'ko',
			'임시 작전 링크 만들기',
			'모든 생성자',
			'2시간 30분 남음',
			'1,234',
			'짧은 코드',
			'페이지당:',
			'임시 작전 30 · 1–25',
		],
	] as const)(
		'translates temp-op creation, filters, rows and pagination in %s',
		async (locale, create, creators, expiry, count, code, perPage, range) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<TempopSection canCreate canManageAll />)
			for (const value of [
				create,
				creators,
				expiry,
				count,
				code,
				perPage,
				range,
				'CODE1',
				'Original &lt;Creator&gt;',
				'TempOp',
			])
				expect(html).toContain(value)
			expect(html).toContain('aria-pressed="false"')
			expect(html.match(/<table/g)).toHaveLength(1)
			const member = renderUI(<TempopSection canCreate={false} canManageAll={false} />)
			expect(member).not.toContain(create)
			expect(member).not.toContain('tempop-creator')
		}
	)
	it('translates expiry/status edge cases and respects per-row deletion permission', async () => {
		await setAppLocale('ko', { persistLocal: false })
		client.setQueryData(listKey, {
			...tempopList,
			items: [
				{ ...tempopList.items[0], id: 'expired', status: 'expired' },
				{ ...tempopList.items[0], id: 'deleted', status: 'deleted' },
				{ ...tempopList.items[0], id: 'soon', canDelete: false, expiresAt: '2026-09-14T10:05:00Z' },
				{
					...tempopList.items[0],
					id: 'invalid',
					status: 'constructor',
					canDelete: false,
					expiresAt: 'invalid',
				},
			],
		})
		const html = renderUI(<TempopSection canCreate={false} canManageAll />)
		for (const value of ['만료됨', '삭제됨', '5분 남음', '알 수 없는 상태'])
			expect(html).toContain(value)
		expect(html.match(/>삭제<\/button>/g)).toHaveLength(1)
	})
	it('renders translated loading, empty and error states', async () => {
		await setAppLocale('de', { persistLocal: false })
		client.setQueryData(mumbleKeys.account(), {
			account: null,
			connection: mumbleCredentials.connection,
		})
		expect(renderUI(<MumblePage />)).toContain('Noch kein Mumble-Konto')
		client.removeQueries({ queryKey: mumbleKeys.account() })
		expect(renderUI(<MumblePage />)).toContain('Mumble-Konto wird geladen…')
		await client.prefetchQuery({
			queryKey: mumbleKeys.account(),
			queryFn: () => Promise.reject('failure'),
		})
		expect(renderUI(<MumblePage />)).toContain('Dein Mumble-Konto konnte nicht geladen werden.')
		client.setQueryData(listKey, { ...tempopList, items: [] })
		expect(renderUI(<TempopSection canCreate={false} canManageAll={false} />)).toContain(
			'Keine Temp-Ops entsprechen diesen Filtern.'
		)
		client.removeQueries({ queryKey: listKey })
		await client.prefetchQuery({
			queryKey: listKey,
			queryFn: () => Promise.reject(new Error('Original <error>')),
		})
		expect(renderUI(<TempopSection canCreate={false} canManageAll={false} />)).toContain(
			'Original &lt;error&gt;'
		)
	})
	it('preserves member and feature access gates', () => {
		for (const session of [
			{ authenticated: false, user: null },
			{ authenticated: true, user: { ...mumbleMember, roles: [] } },
		]) {
			client.setQueryData(['auth', 'session'], session)
			expect(renderUI(<MumblePage />)).toBe('')
		}
		client.setQueryData(['auth', 'session'], { authenticated: true, user: mumbleMember })
		client.setQueryData(['feature-flags'], { 'mumble.enabled': false })
		expect(renderUI(<MumblePage />)).toBe('')
	})
	it.each([
		['en', 'Join voice', 'Identify with EVE', 'Your Mumble credentials'],
		['de', 'Sprachserver beitreten', 'Mit EVE identifizieren', 'Deine Mumble-Zugangsdaten'],
		['ko', '음성 채팅 참여', 'EVE로 인증', '내 Mumble 접속 정보'],
	] as const)(
		'renders public joining and handoff credentials in %s',
		async (locale, title, identify, credentials) => {
			await setAppLocale(locale, { persistLocal: false })
			client.setQueryData(['tempop-info', 'OriginalToken'], { valid: true, expired: false })
			expect(renderUI(<TempopGuestPage />, '/tempop/OriginalToken')).toContain(identify)
			expect(page.title).toBe(title)
			client.setQueryData(
				['tempop-credentials', 'OriginalToken', 'OriginalHandoff'],
				mumbleCredentials
			)
			const html = renderUI(
				<TempopGuestPage />,
				'/tempop/OriginalToken?provisioned=1&h=OriginalHandoff'
			)
			expect(html).toContain(credentials)
			expect(html).not.toContain('OriginalHandoff')
			expect(html).toContain('Fixture/@:? &amp;비밀')
		}
	)
	it('translates guest failures and handles unknown or prototype error codes safely', async () => {
		await setAppLocale('ko', { persistLocal: false })
		for (const [code, message] of [
			['sso', 'EVE 로그인에 실패했습니다.'],
			['expired', '이 임시 작전 링크가 만료되었습니다.'],
			['blacklisted', '이 캐릭터는 이 음성 서버에 참여할 수 없습니다.'],
			['provision', '음성 계정을 만들지 못했습니다.'],
			['invalid', '이 링크가 유효하지 않습니다.'],
			['constructor', '문제가 발생했습니다.'],
			['future', '문제가 발생했습니다.'],
		])
			expect(renderUI(<TempopGuestPage />, `/tempop/OriginalToken?error=${code}`)).toContain(
				message
			)
		expect(renderUI(<TempopGuestPage />, '/tempop/OriginalToken?provisioned=1')).toContain(
			'일회성 접속 정보가 만료되었습니다.'
		)
		client.setQueryData(['tempop-info', 'OriginalToken'], { valid: false, expired: true })
		expect(renderUI(<TempopGuestPage />, '/tempop/OriginalToken')).toContain('링크 만료됨')
	})
})
