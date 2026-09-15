import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applicationsApi } from '@/features/applications/api'
import { ApplicationCard } from '@/features/applications/components/application-card'
import { ApplicationStatsCard } from '@/features/applications/components/application-stats-card'
import { ApplicationStatusBadge } from '@/features/applications/components/application-status-badge'
import { SubmitApplicationDialog } from '@/features/applications/components/submit-application-dialog'
import { applicationKeys, useSubmitApplication } from '@/features/applications/hooks'
import MyApplicationsList from '@/features/applications/routes/my-applications-list'
import { I18nProvider, setAppLocale } from '@/i18n'

import { applicant, application } from '../fixtures/applicant-workflows'

import type { ReactNode } from 'react'

const page = vi.hoisted(() => ({ title: '' }))
vi.mock('@/hooks/usePageTitle', () => ({
	usePageTitle: (title: string) => {
		page.title = title
	},
}))

// Inspect dialog copy in node; browser checks exercise the real Radix dialog.
vi.mock('@/components/ui/dialog', () => ({
	Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <>{children}</> : null,
	DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}))

let client: QueryClient

function renderUI(children: ReactNode) {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MemoryRouter initialEntries={['/my-applications']}>{children}</MemoryRouter>
			</I18nProvider>
		</QueryClientProvider>
	)
}

describe('applicant submission and list localization', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-09-13T12:00:00Z'))
		client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
		client.setQueryData(['auth', 'session'], { authenticated: true, user: applicant })
		client.setQueryData(['applications', 'mine'], [application])
	})

	afterEach(async () => {
		client.clear()
		await setAppLocale('en', { persistLocal: false })
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	it.each([
		['en', 'My Applications', 'Under Review', '2 hours ago', '1,234 recommendations'],
		['de', 'Meine Bewerbungen', 'In Prüfung', 'vor 2 Stunden', '1.234 Empfehlungen'],
		['ko', '내 지원서', '검토 중', '2시간 전', '추천 1,234개'],
	] as const)(
		'renders the non-admin list and formats metadata in %s',
		async (locale, title, status, time, count) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<MyApplicationsList />)
			expect(page.title).toBe(title)
			expect(html).toContain(title)
			expect(html).toContain(status)
			expect(html).toContain(time)
			expect(html).toContain(`title="${count}"`)
			expect(html).toContain('aria-pressed="true"')
			expect(html).toContain('Original &lt;Corporation&gt;')
			expect(html).toContain('Original &lt;application&gt; text — 지원 내용')
			expect(html).toContain('/images/characters/123456789/portrait?size=64')
			expect(html).not.toContain('<application>')
		}
	)

	it.each([
		[
			'en',
			'Apply to Original &lt;Corporation&gt;',
			'25 more characters required',
			'0 / 2,000 characters',
			'(No valid token)',
		],
		[
			'de',
			'Bei Original &lt;Corporation&gt; bewerben',
			'Noch 25 Zeichen erforderlich',
			'0 / 2.000 Zeichen',
			'(Kein gültiges Token)',
		],
		[
			'ko',
			'Original &lt;Corporation&gt;에 지원',
			'25자 더 입력해야 합니다',
			'0 / 2,000자',
			'(유효한 토큰 없음)',
		],
	] as const)(
		'renders submission copy and preserves initial validation in %s',
		async (locale, title, remaining, counter, token) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(
				<SubmitApplicationDialog
					open
					onOpenChange={() => {}}
					corporationId={application.corporationId}
					corporationName={application.corporationName!}
				/>
			)
			expect(html).toContain(title)
			expect(html).toContain(remaining)
			expect(html).toContain(counter)
			expect(html).toContain(token)
			expect(html).toContain('Main &lt;Pilot&gt;')
			expect(html).toContain('Alt &lt;Pilot&gt;')
			expect(html).toContain('maxLength="2000"')
			expect(html).toContain('disabled=""')
			expect(html).toContain('for="application-text"')
		}
	)

	it('translates empty, loading, and failure states while retaining server detail', async () => {
		await setAppLocale('ko', { persistLocal: false })
		client.setQueryData(['applications', 'mine'], [])
		expect(renderUI(<MyApplicationsList />)).toContain('아직 지원서가 없습니다')
		client.removeQueries({ queryKey: ['applications', 'mine'] })
		expect(renderUI(<MyApplicationsList />)).toContain('불러오는 중')
		await client.prefetchQuery({
			queryKey: ['applications', 'mine'],
			queryFn: () => Promise.reject('fixture failure'),
		})
		const fallback = renderUI(<MyApplicationsList />)
		expect(fallback).toContain('지원서를 불러오지 못했습니다')
		expect(fallback).toContain('예기치 않은 오류가 발생했습니다')
		await client.prefetchQuery({
			queryKey: ['applications', 'mine'],
			queryFn: () => Promise.reject(new Error('Original <failure>')),
		})
		expect(renderUI(<MyApplicationsList />)).toContain('Original &lt;failure&gt;')
	})

	it('keeps signed-out users out of the list', async () => {
		await setAppLocale('de', { persistLocal: false })
		client.setQueryData(['auth', 'session'], { authenticated: false, user: null })
		expect(renderUI(<MyApplicationsList />)).toBe('')
	})

	it('submits original fields and refreshes the previously visited applicant list', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const captured: { mutation?: ReturnType<typeof useSubmitApplication> } = {}
		function Harness() {
			captured.mutation = useSubmitApplication()
			return null
		}
		const request = {
			corporationId: application.corporationId,
			characterId: applicant.mainCharacterId,
			applicationText: 'Keep this original <text> — 지원 내용',
			altCharacterIds: [applicant.characters[1].characterId],
		}
		const result = { ...application, ...request, id: 'new-application' }
		const submit = vi.spyOn(applicationsApi, 'submitApplication').mockResolvedValue(result)
		client.setQueryData(applicationKeys.list('all'), [application])
		renderUI(<Harness />)
		if (!captured.mutation) throw new Error('Submission hook did not render')

		expect(client.getQueryState(['applications', 'mine'])?.isInvalidated).toBe(false)
		await captured.mutation.mutateAsync(request)
		expect(submit).toHaveBeenCalledExactlyOnceWith(request)
		expect(client.getQueryState(['applications', 'mine'])?.isInvalidated).toBe(true)
		expect(client.getQueryState(applicationKeys.list('all'))?.isInvalidated).toBe(true)
		expect(client.getQueryData(applicationKeys.detail(result.id))).toEqual(result)
	})

	it('localizes every status and handles unrecognized status codes', async () => {
		await setAppLocale('ko', { persistLocal: false })
		for (const [status, label] of [
			['pending', '대기 중'],
			['under_review', '검토 중'],
			['accepted', '수락됨'],
			['completed', '완료됨'],
			['rejected', '거절됨'],
			['withdrawn', '철회됨'],
			['future_status', '알 수 없는 상태'],
			['constructor', '알 수 없는 상태'],
		]) {
			expect(renderUI(<ApplicationStatusBadge status={status} />)).toContain(label)
		}
	})

	it('formats stats and plural metadata without translating supplied application text', async () => {
		await setAppLocale('de', { persistLocal: false })
		expect(renderUI(<ApplicationStatsCard label="In Prüfung" value={1234} />)).toContain('1.234')
		const one = renderUI(
			<ApplicationCard application={{ ...application, recommendationCount: 1 }} />
		)
		expect(one).toContain('title="1 Empfehlung"')
		expect(one).toContain('(+1 Alt)')
		const two = renderUI(
			<ApplicationCard
				application={{
					...application,
					isFirstApplication: false,
					applicationTextPreview: undefined,
					altCharacters: [
						applicant.characters[1],
						{ characterId: '345678912', characterName: 'Second Alt' },
					],
				}}
			/>
		)
		expect(two).toContain('(+2 Alts)')
		expect(two).toContain('Erneute Bewerbung')
		expect(two).toContain('Bewerbung eingereicht')
	})
})
