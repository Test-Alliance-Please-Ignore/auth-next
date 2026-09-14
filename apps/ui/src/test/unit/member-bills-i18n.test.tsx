import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BillDetailContent, BillDetailState } from '@/components/bills/bill-detail-content'
import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { LayoutScrollProvider } from '@/components/layout-scroll-context'
import { userBillsKeys } from '@/features/bills/query-keys'
import BillDetailPage from '@/features/bills/routes/bill-detail'
import MyBillsPage from '@/features/bills/routes/my-bills'
import { getActiveLocale, I18nProvider, setAppLocale } from '@/i18n'
import { formatBillStatus, formatDueDate, formatEntityType } from '@/lib/bills-utils'

import { applicant } from '../fixtures/applicant-workflows'
import { billingIssuerPermission, memberBill, memberGroupBill } from '../fixtures/member-bills'

import type { ReactNode } from 'react'
import type { BillStatus } from '@repo/bills'

const page = vi.hoisted(() => ({ title: '' }))
vi.mock('@/hooks/usePageTitle', () => ({
	usePageTitle: (title: string) => {
		page.title = title
	},
}))
let client: QueryClient
const listKey = userBillsKeys.list({
	status: undefined,
	payerType: undefined,
	payeeType: undefined,
	payerId: undefined,
	payeeId: undefined,
	dueAfter: '2026-09-14',
	dueBefore: undefined,
	limit: 25,
	offset: 0,
	sortBy: 'dueDate',
	sortDir: 'asc',
})
function renderUI(children: ReactNode, path = '/my-bills') {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MantineProvider>
					<DatesProvider settings={{ locale: getActiveLocale() }}>
						<LayoutScrollProvider>
							<MemoryRouter initialEntries={[path]}>
								<Routes>
									<Route path="/my-bills/:billId" element={children} />
									<Route path="*" element={children} />
								</Routes>
							</MemoryRouter>
						</LayoutScrollProvider>
					</DatesProvider>
				</MantineProvider>
			</I18nProvider>
		</QueryClientProvider>
	)
}
beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date('2026-09-14T12:00:00'))
	client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
	client.setQueryData(['auth', 'session'], {
		authenticated: true,
		user: applicant,
		permissions: [],
	})
	client.setQueryData(listKey, { rows: [memberBill, memberGroupBill], rowCount: 1234 })
	client.setQueryData(userBillsKeys.detail(memberBill.id), memberBill)
})
afterEach(async () => {
	client.clear()
	vi.useRealTimers()
	await setAppLocale('en', { persistLocal: false })
})

describe('member bills localization', () => {
	it.each([
		['en', 'Bills', 'Payer', 'Mixed', '1–25 of 1,234 bills', 'Due today', 'View'],
		[
			'de',
			'Rechnungen',
			'Zahler',
			'Gemischt',
			'Rechnungen: 1–25 von 1.234',
			'Heute fällig',
			'Ansehen',
		],
		['ko', '청구서', '납부자', '혼합', '청구서 1,234 · 1–25', '오늘 납부 기한', '보기'],
	] as const)(
		'renders list, filters, canonical links and grouped counts in %s',
		async (locale, title, payer, mixed, range, today, view) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<MyBillsPage />)
			for (const text of [
				title,
				payer,
				mixed,
				range,
				today,
				view,
				'Original &lt;Bill&gt;',
				'Original &lt;Payer&gt;',
				'9007199254740993001',
			])
				expect(html).toContain(text)
			expect(page.title).toBe(title)
			expect(html).toContain('href="/my-bills/group/group%2Fid%20original"')
			expect(html).not.toContain('href="/bills/issue"')
			expect(html).not.toContain('bills.filters.')
		}
	)
	it.each([
		[
			'en',
			'Bill Details',
			'Payment Summary',
			'Payment History',
			'2 payments recorded',
			'9,007,199,254,740,993.12 ISK',
			'9,007,199,254,740,994.37 ISK',
			'9,007,199,254,739,993.62 ISK',
			'Weekly',
		],
		[
			'de',
			'Rechnungsdetails',
			'Zahlungsübersicht',
			'Zahlungsverlauf',
			'2 Zahlungen erfasst',
			'9.007.199.254.740.993,12 ISK',
			'9.007.199.254.740.994,37 ISK',
			'9.007.199.254.739.993,62 ISK',
			'Wöchentlich',
		],
		[
			'ko',
			'청구서 상세 정보',
			'납부 요약',
			'납부 내역',
			'납부 2건 기록됨',
			'9,007,199,254,740,993.12 ISK',
			'9,007,199,254,740,994.37 ISK',
			'9,007,199,254,739,993.62 ISK',
			'매주',
		],
	] as const)(
		'renders exact decimal totals and payment history in %s',
		async (locale, details, summary, history, count, amount, total, remaining, weekly) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<BillDetailPage />, `/my-bills/${memberBill.id}`)
			for (const text of [
				details,
				summary,
				history,
				count,
				amount,
				total,
				remaining,
				weekly,
				'ORIGINAL-PAYMENT-TOKEN',
				'9007199254740993003',
				'Original &lt;Paid By&gt;',
			])
				expect(html).toContain(text)
			expect(html).not.toContain('<script>raw</script>')
			expect(html.match(/<table/g)).toHaveLength(1)
			expect(html).not.toContain('bills.payment.')
		}
	)
	it('retains issuer ownership, capability and external-source guards', async () => {
		await setAppLocale('de', { persistLocal: false })
		const detail = () => renderUI(<BillDetailPage />, `/my-bills/${memberBill.id}`)
		expect(detail()).not.toContain('>Als bezahlt markieren<')
		client.setQueryData(['auth', 'session'], {
			authenticated: true,
			user: applicant,
			permissions: [billingIssuerPermission],
		})
		expect(renderUI(<MyBillsPage />)).toContain('href="/bills/issue"')
		expect(detail()).toContain('>Als bezahlt markieren<')
		expect(detail()).toContain('>Stornieren<')
		client.setQueryData(userBillsKeys.detail(memberBill.id), {
			...memberBill,
			issuerId: 'someone-else',
			canMarkPaid: false,
		})
		expect(detail()).not.toContain('>Stornieren<')
		expect(detail()).not.toContain('>Als bezahlt markieren<')
		client.setQueryData(userBillsKeys.detail(memberBill.id), {
			...memberBill,
			externalSourceType: 'corporation-tax',
			canMarkPaid: false,
		})
		expect(detail()).not.toContain('>Stornieren<')
	})
	it('shows localized loading/unavailable states and preserves generic access failures', async () => {
		await setAppLocale('ko', { persistLocal: false })
		expect(renderUI(<BillDetailState isLoading error={null} backHref="/my-bills" />)).toContain(
			'청구서 불러오는 중…'
		)
		const failed = renderUI(
			<BillDetailState isLoading={false} error={Error('Private detail')} backHref="/my-bills" />
		)
		expect(failed).toContain('청구서가 존재하지 않거나 조회 권한이 없습니다.')
		expect(failed).not.toContain('Private detail')
		const empty = renderUI(
			<BillDetailContent bill={{ ...memberBill, payments: [] }} backHref="/my-bills" />
		)
		expect(empty).toContain('아직 납부 내역이 없습니다.')
		expect(empty).toContain('납부 처리가 완료되면 여기에 표시됩니다.')
	})
	it('preserves unfamiliar status/entity codes as supplied text', async () => {
		await setAppLocale('de', { persistLocal: false })
		expect(formatBillStatus('constructor' as BillStatus)).toBe('constructor')
		expect(formatEntityType('future-entity' as 'character')).toBe('future-entity')
		expect(renderUI(<BillStatusBadge status="unbilled" />)).toContain('Nicht abgerechnet')
	})
})

describe('localized bill due dates', () => {
	it.each([
		['en', 'Due today', 'Due tomorrow', '1 day overdue', 'Due in 3 days'],
		['de', 'Heute fällig', 'Morgen fällig', '1 Tag überfällig', 'In 3 Tagen fällig'],
		['ko', '오늘 납부 기한', '내일 납부 기한', '1일 연체', '납부 기한까지 3일'],
	] as const)(
		'compares calendar dates rather than elapsed 24-hour intervals in %s',
		async (locale, today, tomorrow, overdue, inDays) => {
			await setAppLocale(locale, { persistLocal: false })
			expect(formatDueDate('2026-09-14', 'issued')).toContain(today)
			expect(formatDueDate(new Date('2026-09-14T00:00:00'), 'issued')).toContain(today)
			expect(formatDueDate('2026-09-15', 'issued')).toContain(tomorrow)
			expect(formatDueDate('2026-09-13', 'issued')).toContain(overdue)
			expect(formatDueDate('2026-09-17', 'issued')).toContain(inDays)
			expect(formatDueDate('2026-09-13', 'paid')).not.toContain('(')
			expect(formatDueDate('invalid', 'issued')).not.toContain('Invalid')
		}
	)
})
