import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FreightFeedback } from '@/features/freight/feedback'
import FreightContractsPage from '@/features/freight/routes/contracts'
import FreightCalculatorPage from '@/features/freight/routes/index'
import FreightLeaderboardPage from '@/features/freight/routes/leaderboard'
import FreightManagePage from '@/features/freight/routes/manage'
import FreightManageEditPage from '@/features/freight/routes/manage-edit'
import FreightManageNewPage from '@/features/freight/routes/manage-new'
import {
	formatNumber,
	formatTimeRemaining,
	getExpirationOptions,
	getNumberInputSeparators,
} from '@/features/freight/utils'
import { freightContractKeys, useOpenContractInGame } from '@/hooks/useFreightContracts'
import { freightRouteKeys } from '@/hooks/useFreightRoutes'
import { i18n, I18nProvider, setAppLocale } from '@/i18n'
import { freightApi } from '@/lib/freight-api'
import toast from '@/lib/toast'

import type { ReactNode } from 'react'
import type { FreightRoute } from '@repo/freight'
import type { AppTranslator } from '@/i18n'

const page = vi.hoisted(() => ({ title: '' }))
vi.mock('@/hooks/usePageTitle', () => ({
	usePageTitle: (title: string) => {
		page.title = title
	},
}))
vi.mock('@/lib/toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const route: FreightRoute = {
	id: 'route-original',
	pickupName: 'Jita',
	destinationName: 'Amarr',
	pickupSystemId: '30000142',
	destinationSystemId: '30002187',
	iskPerVolumeUnit: '1234.5',
	minReward: '1000000',
	maxVolume: '123456.78',
	collateralFeeRate: '0.015',
	expiration: 7,
	daysToComplete: 3,
	notes: 'Original route notes <keep>',
	sortOrder: 0,
	status: 'active',
	createdAt: new Date('2026-01-01'),
	updatedAt: new Date('2026-01-01'),
}
let client: QueryClient
const translate: AppTranslator = (key, values) => String(i18n.t(key, values))
function renderUI(children: ReactNode, path = '/freight') {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<MantineProvider>
					<MemoryRouter initialEntries={[path]}>
						<Routes>
							<Route path="/freight/manage/:id/edit" element={children} />
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
	client.setQueryData(freightRouteKeys.list({ status: 'active' }), [route])
	client.setQueryData(freightRouteKeys.list(), [route])
	client.setQueryData(freightRouteKeys.detail(route.id), route)
	client.setQueryData(
		freightContractKeys.list({
			status: 'outstanding',
			page: 1,
			pageSize: 25,
			sortBy: 'expires',
			sortDirection: 'asc',
		}),
		{
			items: [
				{
					id: 'contract-row',
					contractId: '123456789',
					startLocationName: 'Jita',
					endLocationName: 'Amarr',
					volume: '1234.5',
					reward: '1234567.89',
					collateral: '1000000',
					daysToComplete: 3,
					dateExpired: '2099-01-01T00:00:00Z',
				},
			],
			pagination: {
				page: 1,
				limit: 25,
				totalItems: 1,
				totalPages: 1,
				hasNextPage: false,
				hasPreviousPage: false,
			},
		}
	)
	client.setQueryData([...freightContractKeys.leaderboard(), 'month'], {
		entries: [
			{
				acceptorId: '7001',
				acceptorName: 'Original Pilot',
				contractsCompleted: 1234,
				totalVolume: 1234567,
				totalReward: 1000000,
			},
		],
		oldestContractDate: null,
	})
})
afterEach(async () => {
	client.clear()
	vi.restoreAllMocks()
	vi.clearAllMocks()
	await setAppLocale('en', { persistLocal: false })
})

describe('freight localization', () => {
	it.each([
		[
			'en',
			'Freight Calculator',
			'Open Contracts',
			'Freight Leaderboard',
			'Freight Routes',
			'Create Freight Route',
			'Edit Freight Route',
			'1,234.50 ISK',
		],
		[
			'de',
			'Frachtrechner',
			'Offene Verträge',
			'Fracht-Rangliste',
			'Frachtrouten',
			'Frachtroute erstellen',
			'Frachtroute bearbeiten',
			'1.234,50 ISK',
		],
		[
			'ko',
			'운송 계산기',
			'미수락 계약',
			'운송 순위',
			'운송 경로',
			'운송 경로 생성',
			'운송 경로 편집',
			'1,234.50 ISK',
		],
		[
			'es-MX',
			'Calculadora de transporte',
			'Contratos abiertos',
			'Clasificación de transporte',
			'Rutas de transporte',
			'Crear ruta de transporte',
			'Editar ruta de transporte',
			'1,234.50 ISK',
		],
	] as const)(
		'renders all freight pages in %s without translating names or route IDs',
		async (locale, calculator, contracts, leaderboard, manage, create, edit, price) => {
			await setAppLocale(locale, { persistLocal: false })
			const calculatorHtml = renderUI(<FreightCalculatorPage />)
			expect(calculatorHtml).toContain(calculator)
			expect(page.title).toBe(calculator)
			const contractsHtml = renderUI(<FreightContractsPage />)
			expect(contractsHtml).toContain(contracts)
			expect(contractsHtml).toContain('Jita')
			expect(contractsHtml).toContain('Amarr')
			expect(page.title).toBe(contracts)
			const leaderboardHtml = renderUI(<FreightLeaderboardPage />)
			expect(leaderboardHtml).toContain(leaderboard)
			expect(leaderboardHtml).toContain('Original Pilot')
			expect(leaderboardHtml).toContain(locale === 'de' ? '1.234.567' : '1,234,567')
			const manageHtml = renderUI(<FreightManagePage />)
			expect(manageHtml).toContain(manage)
			expect(manageHtml).toContain(price)
			expect(manageHtml).toContain('href="/freight/manage/route-original/edit"')
			expect(manageHtml).toContain(`aria-label="${i18n.t('freight.manage.deactivateTitle')}"`)
			expect(manageHtml).toContain(i18n.t('freight.common.active'))
			const newHtml = renderUI(<FreightManageNewPage />)
			expect(newHtml).toContain(create)
			expect(newHtml).toContain(i18n.t('freight.form.pickupHint'))
			expect(newHtml).toContain('id="iskPerVolumeUnit"')
			expect(newHtml).toContain('href="/freight/manage"')
			const editHtml = renderUI(<FreightManageEditPage />, '/freight/manage/route-original/edit')
			expect(editHtml).toContain(edit)
			expect(page.title).toBe(i18n.t('freight.form.editTitleFor', { name: 'Jita' }))
			for (const html of [
				calculatorHtml,
				contractsHtml,
				leaderboardHtml,
				manageHtml,
				newHtml,
				editHtml,
			])
				expect(html).not.toContain('freight.form.')
		}
	)

	it('localizes volume and duration displays while retaining expiration option values', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00Z'))
		await setAppLocale('de', { persistLocal: false })
		expect(formatNumber('1234.5')).toBe('1.234,5')
		expect(getNumberInputSeparators('de')).toEqual({
			thousandSeparator: '.',
			decimalSeparator: ',',
		})
		expect(getExpirationOptions(translate).map(({ value }) => value)).toEqual([
			'1',
			'3',
			'7',
			'14',
			'28',
		])
		expect(getExpirationOptions(translate)[2].label).toBe('1 Woche')
		await setAppLocale('es-MX', { persistLocal: false })
		expect(getNumberInputSeparators('es-MX')).toEqual({
			thousandSeparator: ',',
			decimalSeparator: '.',
		})
		expect(getExpirationOptions(translate)[2].label).toBe('1 semana')
		expect(formatTimeRemaining('2026-01-01T01:00:00Z', translate)).toBe('1 hora')
		expect(formatTimeRemaining('2026-01-02T02:00:00Z', translate)).toBe('1 día y 2 horas')
		expect(formatTimeRemaining('2025-12-31T23:00:00Z', translate)).toBe('Vencido')
		expect(formatTimeRemaining('bad date', translate)).toBe('N/D')
	})

	it('uses translated empty and missing-route states', async () => {
		await setAppLocale('es-MX', { persistLocal: false })
		client.setQueryData(freightRouteKeys.list({ status: 'active' }), [])
		client.setQueryData(freightRouteKeys.list(), [])
		client.setQueryData(freightRouteKeys.detail(route.id), null)
		client.setQueryData([...freightContractKeys.leaderboard(), 'month'], { entries: [] })
		expect(renderUI(<FreightCalculatorPage />)).toContain(
			'No hay rutas de transporte disponibles actualmente.'
		)
		expect(renderUI(<FreightManagePage />)).toContain('No se encontraron rutas de transporte')
		expect(renderUI(<FreightLeaderboardPage />)).toContain('Aún no hay contratos completados.')
		expect(renderUI(<FreightManageEditPage />, '/freight/manage/route-original/edit')).toContain(
			'Ruta de transporte no encontrada'
		)
	})

	it('keeps contract action IDs and raw errors intact while feedback follows locale changes', async () => {
		let mutation: ReturnType<typeof useOpenContractInGame> | undefined
		function Harness() {
			mutation = useOpenContractInGame()
			return null
		}
		const open = vi
			.spyOn(freightApi, 'openContractInGame')
			.mockResolvedValue({ success: true, characterName: 'Original Pilot' })
		renderUI(<Harness />)
		await mutation!.mutateAsync('123456789')
		expect(open).toHaveBeenCalledWith('123456789')
		const feedback = vi.mocked(toast.success).mock.calls[0][0]
		await setAppLocale('es-MX', { persistLocal: false })
		expect(renderUI(feedback)).toContain('Abriendo el contrato en el cliente de Original Pilot')
		await setAppLocale('de', { persistLocal: false })
		expect(renderUI(feedback)).toContain('Vertrag wird im Client von Original Pilot geöffnet')
		expect(
			renderUI(
				<FreightFeedback
					messageKey="freight.contracts.openFailed"
					error={new Error('Raw server message')}
				/>
			)
		).toContain('Raw server message')
	})
})
