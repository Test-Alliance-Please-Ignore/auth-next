import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AddRecommendationDialog } from '@/features/applications/components/add-recommendation-dialog'
import { DeleteRecommendationDialog } from '@/features/applications/components/delete-recommendation-dialog'
import { RecommendationList } from '@/features/applications/components/recommendation-list'
import { RecommendationSentimentBadge } from '@/features/applications/components/recommendation-sentiment-badge'
import { applicationKeys } from '@/features/applications/hooks'
import RecommendationsList from '@/features/applications/routes/recommendations-list'
import { entityKeys } from '@/hooks/useEntityNames'
import { I18nProvider, setAppLocale } from '@/i18n'

import { detailedApplication } from '../fixtures/applicant-details'
import { recommendableApplication, recommendation } from '../fixtures/applicant-recommendations'
import { applicant, application } from '../fixtures/applicant-workflows'

import type { ReactNode } from 'react'
import type { RecommendationSentiment } from '@/features/applications/api'

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

describe('applicant recommendation localization', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-09-13T12:00:00Z'))
		client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
		client.setQueryData(['auth', 'session'], { authenticated: true, user: applicant })
		client.setQueryData(applicationKeys.recommendationsPending(), [recommendableApplication])
		client.setQueryData(entityKeys.names([application.corporationId]), {
			[application.corporationId]: application.corporationName,
		})
		client.setQueryData(applicationKeys.detail(application.id), {
			...detailedApplication,
			recommendations: [recommendation],
		})
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
			'Recommendations',
			'Recommend',
			'2 hours ago',
			'1,234',
			'Positive',
			'Edit your recommendation for Candidate &lt;Pilot&gt;',
		],
		[
			'de',
			'Empfehlungen',
			'Empfehlen',
			'vor 2 Stunden',
			'1.234',
			'Positiv',
			'Deine Empfehlung für Candidate &lt;Pilot&gt; bearbeiten',
		],
		[
			'ko',
			'추천',
			'추천하기',
			'2시간 전',
			'1,234',
			'긍정적',
			'Candidate &lt;Pilot&gt; 지원자에 대한 내 추천 수정',
		],
	] as const)(
		'renders discovery and owner actions in %s',
		async (locale, title, action, time, count, sentiment, edit) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<RecommendationsList />)
			expect(page.title).toBe(title)
			for (const text of [
				title,
				action,
				time,
				count,
				'Candidate &lt;Pilot&gt;',
				'Original &lt;Corporation&gt;',
			])
				expect(html).toContain(text)
			expect(html).not.toContain('aria-label="' + edit + '"')
			client.setQueryData(applicationKeys.recommendationsPending(), [
				{
					...recommendableApplication,
					userHasRecommended: true,
					userRecommendation: recommendation,
				},
			])
			const owned = renderUI(<RecommendationsList />)
			expect(owned).toContain('aria-label="' + edit + '"')
			expect(owned).toContain(sentiment)
			expect(owned).toContain('Original &lt;recommendation&gt; text — 추천 내용')
		}
	)
	it.each([
		[
			'en',
			'Add Recommendation',
			'Edit Recommendation',
			'Delete Recommendation',
			'Minimum 10 characters',
			'Only visible to HR staff',
		],
		[
			'de',
			'Empfehlung hinzufügen',
			'Empfehlung bearbeiten',
			'Empfehlung löschen',
			'Mindestens 10 Zeichen',
			'Nur für das HR-Team sichtbar',
		],
		['ko', '추천 추가', '추천 수정', '추천 삭제', '최소 10자', 'HR 담당자에게만 표시됩니다'],
	] as const)(
		'renders add/edit/delete dialog copy and initial validation in %s',
		async (locale, add, edit, remove, minimum, privateHint) => {
			await setAppLocale(locale, { persistLocal: false })
			const props = {
				open: true,
				onOpenChange: () => {},
				applicationId: application.id,
				applicationUserId: 'other-user',
			}
			const html = renderUI(<AddRecommendationDialog {...props} />)
			for (const text of [
				add,
				minimum,
				privateHint,
				'0 / 500',
				'maxLength="500"',
				'aria-pressed="true"',
				'for="recommendation-text"',
			])
				expect(html).toContain(text)
			expect(
				renderUI(<AddRecommendationDialog {...props} existingRecommendation={recommendation} />)
			).toContain(edit)
			const deletion = renderUI(
				<DeleteRecommendationDialog open onOpenChange={() => {}} recommendation={recommendation} />
			)
			expect(deletion).toContain(remove)
			expect(deletion).toContain('Original &lt;recommendation&gt; text — 추천 내용')
		}
	)
	it('restricts the applicant tab to public and own recommendations while preserving HR view', async () => {
		await setAppLocale('de', { persistLocal: false })
		client.setQueryData(applicationKeys.detail(application.id), {
			...detailedApplication,
			recommendations: [
				recommendation,
				{
					...recommendation,
					id: 'private',
					userId: 'other',
					characterName: 'Private author',
					recommendationText: 'Private body',
				},
				{
					...recommendation,
					id: 'public',
					userId: 'public-author',
					isPublic: true,
					characterName: 'Public author',
					recommendationText: 'Public body',
				},
			],
		})
		const props = {
			applicationId: application.id,
			currentUserId: applicant.id,
			onAddRecommendation: () => {},
			onEditRecommendation: () => {},
			onDeleteRecommendation: () => {},
		}
		const applicantHtml = renderUI(<RecommendationList {...props} applicantView />)
		expect(applicantHtml).toContain('Empfehlungen (2)')
		expect(applicantHtml).toContain('Public body')
		expect(applicantHtml).toContain('Original &lt;recommendation&gt;')
		expect(applicantHtml).not.toContain('Private author')
		expect(applicantHtml).not.toContain('Private body')
		expect(applicantHtml).not.toContain('Empfehlung hinzufügen')
		expect(applicantHtml.match(/>Bearbeiten<\/button>/g)).toHaveLength(1)
		const hrHtml = renderUI(<RecommendationList {...props} />)
		expect(hrHtml).toContain('Empfehlungen (3)')
		expect(hrHtml).toContain('Private body')
	})
	it('translates empty, loading, retry and fallback errors while preserving server details', async () => {
		await setAppLocale('de', { persistLocal: false })
		client.setQueryData(applicationKeys.recommendationsPending(), [])
		expect(renderUI(<RecommendationsList />)).toContain('Keine ausstehenden Bewerbungen')
		client.setQueryData(applicationKeys.detail(application.id), {
			...detailedApplication,
			recommendations: [],
		})
		expect(renderUI(<RecommendationList applicationId={application.id} />)).toContain(
			'Noch keine Empfehlungen'
		)
		client.removeQueries({ queryKey: applicationKeys.recommendationsPending() })
		expect(renderUI(<RecommendationsList />)).toContain('Wird geladen')
		for (const error of ['fixture failure', new Error('Original <error>')]) {
			client.removeQueries({ queryKey: applicationKeys.detail(application.id) })
			await client.prefetchQuery({
				queryKey: applicationKeys.detail(application.id),
				queryFn: () => Promise.reject(error),
			})
			const html = renderUI(<RecommendationList applicationId={application.id} />)
			expect(html).toContain('Empfehlungen konnten nicht geladen werden')
			expect(html).toContain('Erneut versuchen')
			expect(html).toContain(
				error instanceof Error
					? 'Original &lt;error&gt;'
					: 'Ein unerwarteter Fehler ist aufgetreten'
			)
		}
	})
	it('translates all sentiments and safely displays unknown runtime codes', async () => {
		await setAppLocale('ko', { persistLocal: false })
		for (const [sentiment, label] of [
			['positive', '긍정적'],
			['neutral', '중립적'],
			['negative', '부정적'],
			['future', '알 수 없는 평가'],
			['constructor', '알 수 없는 평가'],
		]) {
			expect(
				renderUI(<RecommendationSentimentBadge sentiment={sentiment as RecommendationSentiment} />)
			).toContain(label)
		}
	})
})
