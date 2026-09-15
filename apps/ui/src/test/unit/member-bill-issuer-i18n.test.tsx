import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BillEntityPicker } from '@/components/bills/bill-entity-picker'
import { userBillsKeys } from '@/features/bills/query-keys'
import { groupBillKeys } from '@/hooks/useBills'
import { I18nProvider, setAppLocale } from '@/i18n'
import GroupDetailPage from '@/routes/admin/bills-group-detail'
import GroupEditPage from '@/routes/admin/bills-group-edit'
import NewBillPage from '@/routes/admin/bills-new'

import { applicant } from '../fixtures/applicant-workflows'
import { memberBillGroup, memberIssuerScope } from '../fixtures/member-bill-issuer'

import type { ReactNode } from 'react'

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))
let client: QueryClient
const groupKey = [...groupBillKeys.aggregate(memberBillGroup.groupBillId), 'issuer']
function renderUI(element: ReactNode, path = '/bills/issue') {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MantineProvider>
					<MemoryRouter initialEntries={[path]}>
						<Routes>
							<Route path="/my-bills/group/:groupBillId" element={element} />
							<Route path="/my-bills/group/:groupBillId/edit" element={element} />
							<Route path="*" element={element} />
						</Routes>
					</MemoryRouter>
				</MantineProvider>
			</I18nProvider>
		</QueryClientProvider>
	)
}
beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
	client.setQueryData(['auth', 'session'], {
		authenticated: true,
		user: applicant,
		permissions: [],
	})
	client.setQueryData(userBillsKeys.issuerScope(), memberIssuerScope)
	client.setQueryData(groupKey, memberBillGroup)
})
afterEach(async () => {
	client.clear()
	await setAppLocale('en', { persistLocal: false })
})

describe('member bill issuer localization', () => {
	it.each([
		['en', 'Create Bill', 'Payer Information', 'Search character name or ID', 'Enable Late Fees'],
		[
			'de',
			'Rechnung erstellen',
			'Angaben zum Zahler',
			'Charakter nach Name oder ID suchen',
			'Säumniszuschläge aktivieren',
		],
		['ko', '청구서 생성', '납부자 정보', '캐릭터 이름 또는 ID 검색', '연체료 사용'],
	] as const)(
		'renders the member creation form in %s',
		async (locale, title, payer, search, late) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<NewBillPage />)
			for (const text of [title, payer, search, late]) expect(html).toContain(text)
			expect(html).toContain('href="/my-bills"')
			expect(html).toContain('id="payerType"')
			expect(html).toContain('id="dueDate"')
			expect(html).not.toContain('id="includeOwner"')
			expect(html).not.toContain('bills.form.')
		}
	)
	it.each([
		['en', 'Group Payment Progress', '1,000', '1,234', 'Issued', '9,007,199,254,740,994.37 ISK'],
		[
			'de',
			'Zahlungsfortschritt der Gruppe',
			'1.000',
			'1.234',
			'Ausgestellt',
			'9.007.199.254.740.994,37 ISK',
		],
		['ko', '그룹 납부 현황', '1,000', '1,234', '발행됨', '9,007,199,254,740,994.37 ISK'],
	] as const)(
		'renders group details, counts and statuses in %s',
		async (locale, progress, paid, total, status, amount) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<GroupDetailPage scope="issuer" />, '/my-bills/group/group-original')
			for (const text of [
				progress,
				paid,
				total,
				status,
				amount,
				'Original &lt;Group&gt;',
				'Original &lt;Member 0&gt;',
			])
				expect(html).toContain(text)
			expect(html).toContain('href="/my-bills/bill-issued"')
			expect(html).not.toContain('href="/admin/bills')
			expect(html).not.toContain('<script>raw</script>')
			expect(html).not.toContain('<paid>')
			expect(html.match(/<table/g)).toHaveLength(1)
		}
	)
	it.each([
		[
			'en',
			'Edit Group Bill',
			'3 eligible bills will be updated',
			'Paid and cancelled bills will be skipped.',
			'Apply to All Eligible Bills',
		],
		[
			'de',
			'Gruppenrechnung bearbeiten',
			'3 bearbeitbare Rechnungen werden aktualisiert',
			'Bezahlte und stornierte Rechnungen werden übersprungen.',
			'Auf alle bearbeitbaren Rechnungen anwenden',
		],
		[
			'ko',
			'그룹 청구서 수정',
			'수정 가능한 청구서 3건이 업데이트됩니다',
			'납부 완료되거나 취소된 청구서는 제외됩니다.',
			'수정 가능한 모든 청구서에 적용',
		],
	] as const)(
		'translates the existing group-edit eligibility explanation in %s',
		async (locale, title, eligible, hint, apply) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(<GroupEditPage scope="issuer" />, '/my-bills/group/group-original/edit')
			for (const text of [title, eligible, hint, apply]) expect(html).toContain(text)
			expect(html).toContain('value=""')
			expect(html).not.toContain('value="Original')
		}
	)
	it('translates loading and generic unavailable states without exposing response text', async () => {
		await setAppLocale('de', { persistLocal: false })
		client.removeQueries({ queryKey: groupKey })
		expect(
			renderUI(<GroupDetailPage scope="issuer" />, '/my-bills/group/group-original')
		).toContain('Gruppenrechnung wird geladen')
		client
			.getQueryCache()
			.find({ queryKey: groupKey })
			?.setState({
				status: 'error',
				error: new Error('Original private error'),
				fetchStatus: 'idle',
			})
		for (const element of [
			<GroupDetailPage key="detail" scope="issuer" />,
			<GroupEditPage key="edit" scope="issuer" />,
		]) {
			const html = renderUI(element, '/my-bills/group/group-original')
			expect(html).toContain('Gruppenrechnung nicht gefunden')
			expect(html).not.toContain('Original private error')
		}
	})
	it.each(['de', 'ko'] as const)(
		'retains selected party names, raw IDs and supplied errors in %s',
		async (locale) => {
			await setAppLocale(locale, { persistLocal: false })
			const html = renderUI(
				<BillEntityPicker
					roleLabel="Original Role"
					typeFieldId="type"
					entityFieldId="entity"
					entityType="corporation"
					allowedEntityTypes={['corporation']}
					onEntityTypeChange={vi.fn()}
					query=""
					onQueryChange={vi.fn()}
					options={[]}
					onEntitySelect={vi.fn()}
					loading={false}
					selectedEntityId="9007199254740993002"
					selectedEntityName="Original <Corporation>"
					error="Original <error>"
					staticOptions={memberIssuerScope.corporations?.map((corporation) => ({
						value: corporation.corporationId,
						label: corporation.name,
					}))}
				/>
			)
			for (const text of [
				'9007199254740993002',
				'Original &lt;Corporation&gt;',
				'Original &lt;error&gt;',
			])
				expect(html).toContain(text)
			expect(html).not.toContain('bills.picker.')
		}
	)
})
