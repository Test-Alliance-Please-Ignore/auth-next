import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	getExpirationOptions,
	getPasswordChecks,
	getPasswordValidationError,
	PASSWORD_SYMBOLS,
} from '@/features/pastes/form'
import { I18nProvider, setAppLocale, useAppTranslation } from '@/i18n'
import PasteEditPage from '@/routes/paste-edit'
import PasteViewPage from '@/routes/paste-view'
import PastesPage from '@/routes/pastes'

import { applicant } from '../fixtures/applicant-workflows'
import { myPastes, paste, pasteContent, pasteSettings, pasteView } from '../fixtures/pastes'

import type { ReactNode } from 'react'

const page = vi.hoisted(() => ({ title: '' }))
vi.mock('@/hooks/usePageTitle', () => ({
	usePageTitle: (title: string) => {
		page.title = title
	},
}))
let client: QueryClient
function renderUI(children: ReactNode, path = '/pastes') {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route path="*" element={children} />
						<Route path="/paste/:id" element={children} />
						<Route path="/pastes/:id/edit" element={children} />
					</Routes>
				</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}
function Presets() {
	const { t } = useAppTranslation()
	return (
		<>
			{getExpirationOptions(t).map((option) => (
				<span key={option.value} data-value={option.value}>
					{option.label}
				</span>
			))}
		</>
	)
}

describe('member and public paste localization', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))
		client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
		client.setQueryData(['auth', 'session'], { authenticated: true, user: applicant })
		client.setQueryData(['pastes', 'mine'], myPastes)
		client.setQueryData(['pastes', 'settings'], pasteSettings)
		client.setQueryData(['paste', 'view', paste.id, true], {
			payload: pasteView,
			viewer: 'alliance',
		})
		client.setQueryData(['paste', 'edit', paste.id], pasteView)
	})
	afterEach(async () => {
		client.clear()
		await setAppLocale('en', { persistLocal: false })
		vi.useRealTimers()
	})
	it.each([
		[
			'en',
			'My Pastes',
			'Alliance',
			'Unprotected',
			'Create Paste',
			'1 hour',
			'3 days',
			'Indefinite',
		],
		[
			'de',
			'Meine Pastes',
			'Allianz',
			'Ungeschützt',
			'Paste erstellen',
			'1 Stunde',
			'3 Tage',
			'Unbegrenzt',
		],
		[
			'ko',
			'내 페이스트',
			'얼라이언스',
			'보호되지 않음',
			'페이스트 만들기',
			'1시간',
			'3일',
			'무기한',
		],
	] as const)(
		'translates member list and expiration presets in %s without changing identifiers',
		async (locale, mine, visibility, protection, create, hour, days, indefinite) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<PastesPage />)
			for (const text of [
				mine,
				visibility,
				protection,
				create,
				'Original &lt;paste&gt; — 원문',
				'/paste/Original123',
				'/pastes/Original123/edit',
				'for="paste-password"',
			])
				expect(html).toContain(text)
			expect(html).not.toContain(paste.expiresAt)
			const options = renderUI(<Presets />)
			expect(options).toContain(`data-value="60">${hour}`)
			expect(options).toContain(`data-value="4320">${days}`)
			expect(options).toContain(`data-value="indefinite">${indefinite}`)
		}
	)
	it.each([
		['en', 'Content', 'Password Required', 'Paste', 'Edit Paste'],
		['de', 'Inhalt', 'Passwort erforderlich', 'Paste', 'Paste bearbeiten'],
		['ko', '내용', '비밀번호 필요', '페이스트', '페이스트 수정'],
	] as const)(
		'translates viewer and editor in %s while keeping protected names hidden',
		async (locale, content, password, title, edit) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<PasteViewPage />, `/paste/${paste.id}`)
			expect(page.title).toBe(paste.name)
			expect(html).toContain(content)
			expect(html).toContain('Original &lt;script&gt; content')
			expect(html).not.toContain('<script>')
			client.setQueryData(['paste', 'view', paste.id, true], {
				payload: { ...pasteView, content: null, requiresPassword: true },
				viewer: 'alliance',
			})
			const locked = renderUI(<PasteViewPage />, `/paste/${paste.id}`)
			expect(page.title).toBe(title)
			expect(locked).toContain(password)
			expect(locked).not.toContain(paste.name)
			expect(locked).not.toContain(pasteContent)
			expect(renderUI(<PasteEditPage />, `/pastes/${paste.id}/edit`)).toContain(edit)
		}
	)
	it('offers the locale picker to anonymous visitors and preserves generic 404 errors', async () => {
		await setAppLocale('ko', { persistLocal: false })
		client.setQueryData(['auth', 'session'], { authenticated: false, user: null })
		await client.prefetchQuery({
			queryKey: ['paste', 'view', paste.id, false],
			queryFn: () => Promise.reject(new Error('Private server detail')),
		})
		const html = renderUI(<PasteViewPage />, `/paste/${paste.id}`)
		expect(html).toContain('404 찾을 수 없음')
		expect(html).toContain('요청한 페이스트를 찾을 수 없습니다.')
		expect(html).toContain('언어')
		expect(html).not.toContain('Private server detail')
		expect(html).not.toContain(paste.id)
	})
	it('shows translated loading, empty and failure states in the member list', async () => {
		await setAppLocale('de', { persistLocal: false })
		client.setQueryData(['pastes', 'mine'], { ...myPastes, items: [] })
		expect(renderUI(<PastesPage />)).toContain('Noch keine Pastes.')
		client.removeQueries({ queryKey: ['pastes', 'mine'] })
		expect(renderUI(<PastesPage />)).toContain('Wird geladen')
		for (const error of ['fixture failure', new Error('Original <failure>')]) {
			await client.prefetchQuery({
				queryKey: ['pastes', 'mine'],
				queryFn: () => Promise.reject(error),
			})
			expect(renderUI(<PastesPage />)).toContain(
				error instanceof Error ? 'Original &lt;failure&gt;' : 'Pastes konnten nicht geladen werden.'
			)
		}
	})
	it('keeps creation disabled at the active-paste limit', async () => {
		await setAppLocale('de', { persistLocal: false })
		client.setQueryData(['pastes', 'mine'], {
			...myPastes,
			activeCount: 1234,
			maxActivePastesPerUser: 1234,
		})
		const html = renderUI(<PastesPage />)
		expect(html).toContain('1.234 / 1.234')
		expect(html).toMatch(/id="paste-name"[^>]*disabled=""/)
	})
	it('preserves password validation boundaries and supported symbols', () => {
		expect(getPasswordValidationError('   ')).toBe('pastes.passwordRequired')
		for (const value of [
			'Short1!',
			'alllower1!',
			'ALLUPPER1!',
			'NoNumber!!',
			'NoSymbol12',
			'Password1! ',
			'Password1!😀',
			'A1!' + 'a'.repeat(126),
		])
			expect(getPasswordValidationError(value)).toBe('pastes.passwordInvalid')
		for (const value of [
			'Abcdef1!',
			'A1!' + 'a'.repeat(125),
			...PASSWORD_SYMBOLS.split(' ').map((symbol) => 'Abcdef1' + symbol),
		])
			expect(getPasswordValidationError(value)).toBeNull()
		expect(
			getPasswordChecks('A1!' + 'a'.repeat(126)).find(
				(check) => check.key === 'pastes.passwordLength'
			)?.valid
		).toBe(false)
	})
})
