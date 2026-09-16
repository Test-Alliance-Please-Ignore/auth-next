import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RequestStatusBadge } from '@/features/srp/components/RequestStatusBadge'
import { computeDoctrineConformityFindings } from '@/features/srp/components/ReviewRequestForm'
import { SRPFeedback } from '@/features/srp/components/SRPFeedback'
import { SRPNumberInput } from '@/features/srp/components/SRPNumberInput'
import { srpKeys } from '@/features/srp/query-keys'
import Alerts from '@/features/srp/routes/alerts'
import Create from '@/features/srp/routes/create'
import Dashboard from '@/features/srp/routes/index'
import Payments from '@/features/srp/routes/payments'
import Policies from '@/features/srp/routes/policies'
import RequestDetail from '@/features/srp/routes/request-detail'
import Review from '@/features/srp/routes/review'
import ReviewDetail from '@/features/srp/routes/review-detail'
import Wallet from '@/features/srp/routes/wallet-history'
import { formatFullDate, formatRelativeTime, getRequestStatusText } from '@/features/srp/utils'
import { APP_LOCALES, i18n, I18nProvider, setAppLocale } from '@/i18n'

import { seedSrpI18nQueries, srpRequest } from '../fixtures/srp-i18n'

import type { ReactNode } from 'react'
import type { RequestStatus } from '@repo/srp'
import type { AppTranslator } from '@/i18n'
import type { FittingWithItems } from '@/lib/api'

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))
let client: QueryClient
const translate: AppTranslator = (key, values) => String(i18n.t(key, values))
function renderUI(children: ReactNode, path = '/srp') {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MantineProvider>
					<MemoryRouter initialEntries={[path]}>
						<Routes>
							<Route path="/srp/request/:id" element={children} />
							<Route path="/srp/review/:id" element={children} />
							<Route path="*" element={children} />
						</Routes>
					</MemoryRouter>
				</MantineProvider>
			</I18nProvider>
		</QueryClientProvider>
	)
}
beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
	seedSrpI18nQueries(client)
	vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-16T12:00:00Z'))
})
afterEach(async () => {
	client.clear()
	vi.restoreAllMocks()
	await setAppLocale('en', { persistLocal: false })
})

describe('SRP localization', () => {
	it.each(APP_LOCALES)(
		'renders every SRP page in %s with canonical names and references',
		async (locale) => {
			await setAppLocale(locale, { persistLocal: false })
			const pages = [
				[<Dashboard />, '/srp', 'srp.dashboard.title'],
				[
					<Create />,
					'/srp/create?killmailId=987654321&killmailHash=original-loss-hash',
					'srp.create.title',
				],
				[<RequestDetail />, '/srp/request/123456789', 'srp.detail.lossDetails'],
				[<Review />, '/srp/review', 'srp.queue.title'],
				[<ReviewDetail />, '/srp/review/123456789', 'srp.review.calculation'],
				[<Payments />, '/srp/payments', 'srp.payments.title'],
				[<Policies />, '/srp/policies', 'srp.policies.title'],
				[<Alerts />, '/srp/alerts', 'srp.alerts.title'],
				[<Wallet />, '/srp/wallet-history', 'srp.wallet.title'],
			] as const
			for (const [element, path, titleKey] of pages) {
				const html = renderUI(element, path)
				expect(html, path).toContain(i18n.t(titleKey))
				expect(html, path).not.toMatch(/srp\.(common|status|review|policies|fitting|validation)\./)
			}
			const details = renderUI(<RequestDetail />, '/srp/request/123456789')
			expect(details).toContain('Original context &lt;keep&gt;')
			expect(details).toContain('Original comment &lt;keep&gt;')
			expect(details).toContain('Rifter')
			expect(details).toContain('Jita')
			const payments = renderUI(<Payments />)
			expect(payments).toContain('SRP - KM#123456789')
			expect(payments).toContain('Original Pilot')
			expect(payments).toContain(locale === 'de' ? '123.400.000 ISK' : '123,400,000 ISK')
			const wallet = renderUI(<Wallet />)
			expect(wallet).toContain('href="/srp/request/123456789"')
			expect(wallet).toContain('SRP - KM#123456789')
			const policies = renderUI(<Policies />)
			expect(policies).toContain('Original policy')
			expect(policies).toContain('Original template reason')
		}
	)

	it('translates statuses, history, fitting warnings, dates and feedback after a language change', async () => {
		await setAppLocale('es-MX', { persistLocal: false })
		const statuses: RequestStatus[] = [
			'pending',
			'needs_context',
			'approved',
			'payment_pending',
			'rejected',
			'paid',
			'withdrawn',
		]
		expect(statuses.map((status) => getRequestStatusText(status, translate))).toEqual([
			'Pendiente',
			'Requiere contexto',
			'Aprobada',
			'Pago enviado',
			'Rechazada',
			'Pagada',
			'Retirada',
		])
		expect(renderUI(<RequestStatusBadge status="needs_context" />)).toContain('Requiere contexto')
		const feedback = <SRPFeedback messageKey="srp.common.copied" labelKey="srp.common.amount" />
		expect(renderUI(feedback)).toContain('Monto copiado')
		expect(formatRelativeTime('2026-09-16T10:00:00Z')).toBe('hace 2 horas')
		expect(formatFullDate('2026-09-15T12:00:00Z')).toContain('septiembre')
		const fitting = {
			fittingItems: [{ typeId: '1', typeName: 'Original Rig', flagId: '92', quantity: '2' }],
		} as FittingWithItems
		const findings = computeDoctrineConformityFindings(fitting, [], [], new Set(), new Set(), {})
		expect(findings[0].message).toBe('Faltan 2 módulos de rig')
		expect(findings[0].quantity).toBe(2)
		await setAppLocale('de', { persistLocal: false })
		expect(renderUI(feedback)).toContain('Betrag kopiert')
		expect(renderUI(<SRPNumberInput value="1234.5" />)).toContain('value="1.234,5"')
		expect(formatRelativeTime('2026-09-16T10:00:00Z')).toBe('vor 2 Stunden')
	})

	it('translates empty and unavailable-request states in Spanish', async () => {
		await setAppLocale('es-MX', { persistLocal: false })
		client.setQueryData(srpKeys.request(srpRequest.id), null)
		client.setQueryData(srpKeys.pendingPayments({ limit: 100 }), { requests: [], total: 0 })
		expect(renderUI(<RequestDetail />, '/srp/request/123456789')).toContain(
			'No se pudo cargar la solicitud'
		)
		expect(renderUI(<Payments />)).toContain('¡Todo al día!')
		expect(renderUI(<Create />, '/srp/create?killmailId=missing&killmailHash=hash')).toContain(
			'No se encontró el reporte de pérdida'
		)
	})
})
