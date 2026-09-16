import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { InventoryBaysTable } from '@/components/inventory-bays-table'
import { StructureStateBadge } from '@/components/structure-state-badge'
import { TotalTaxesReportGrid } from '@/components/tax-reports/grids/total-taxes-report-grid'
import { SessionStatusPill } from '@/features/fleet-tracking/components/session-status-pill'
import { SERVICE_TYPE_LABELS } from '@/features/industry/types'
import { ScanStatusBadge } from '@/features/moon-scan/components/ScanStatusBadge'
import { SkillPlanCard } from '@/features/skill-plans/components/skill-plan-card'
import { i18n, I18nProvider, setAppLocale } from '@/i18n'
import { formatStructureLabel } from '@/lib/structure-labels'
import { getTaxRefTypeOptions } from '@/lib/tax-display'

import type { ReactNode } from 'react'
import type { SkillPlan } from '@/features/skill-plans/types'

function renderUI(children: ReactNode) {
	return renderToStaticMarkup(
		<I18nProvider>
			<MantineProvider>
				<MemoryRouter>{children}</MemoryRouter>
			</MantineProvider>
		</I18nProvider>
	)
}

afterEach(async () => {
	await setAppLocale('en', { persistLocal: false })
})

describe('Spanish user pages', () => {
	it('translates tax report columns and the empty result message', async () => {
		await setAppLocale('es-MX', { persistLocal: false })
		const html = renderUI(
			<TotalTaxesReportGrid
				rows={[]}
				loading={false}
				error={null}
				entityNames={{}}
				sorting={[]}
				onSortingChange={() => {}}
				pagination={{ pageIndex: 0, pageSize: 25 }}
				onPaginationChange={() => {}}
				rowCount={0}
			/>
		)
		expect(html).toContain('Conceptos gravables')
		expect(html).toContain('Impuesto por pagar')
		expect(html).toContain('No se encontraron totales.')
		expect(html).not.toContain('Taxable Items')
	})

	it('resolves default inventory copy and status badges in Spanish', async () => {
		await setAppLocale('es-MX', { persistLocal: false })
		const html = renderUI(
			<>
				<InventoryBaysTable bays={[]} />
				<StructureStateBadge state="armor_reinforce" />
				<SessionStatusPill status="ended" />
				<ScanStatusBadge status="pending" />
			</>
		)
		expect(html).toContain('No hay inventario registrado para esta estructura.')
		expect(html).toContain('Reforzada (blindaje)')
		expect(html).toContain('Pendiente')
		expect(html).not.toContain('Ended')
		expect(html).not.toContain('Pending')
	})

	it.each([0, 1, 2])(
		'renders a skill plan with %s skills and preserves its authored name',
		async (count) => {
			await setAppLocale('es-MX', { persistLocal: false })
			const plan: SkillPlan = {
				id: 'plan-1',
				name: 'Original plan <keep>',
				description: 'Player-authored description',
				isPublished: true,
				maintainerId: null,
				ownerCharacterId: null,
				createdAt: '2026-01-01T00:00:00Z',
				updatedAt: '2026-01-01T00:00:00Z',
				skills: Array.from({ length: count }, (_, index) => ({
					skillId: String(index),
					skillName: 'Gunnery',
					skillGroup: 'Gunnery',
					requiredLevel: 1,
					recommendedLevel: 3,
					addedAt: '2026-01-01T00:00:00Z',
				})),
			}
			const html = renderUI(<SkillPlanCard plan={plan} />)
			expect(html).toContain(`${count} ${count === 1 ? 'habilidad' : 'habilidades'} en este plan`)
			expect(html).toContain('Original plan &lt;keep&gt;')
			expect(html).toContain('Player-authored description')
		}
	)

	it('refreshes display labels after switching languages without changing filter values', async () => {
		await setAppLocale('en', { persistLocal: false })
		const english = getTaxRefTypeOptions()
		expect(SERVICE_TYPE_LABELS.general_manufacturing).toBe('General Manufacturing')
		expect(formatStructureLabel('sovereignty')).toBe('Sovereignty')

		await setAppLocale('es-MX', { persistLocal: false })
		const spanish = getTaxRefTypeOptions()
		expect(spanish.map((option) => option.value)).toEqual(english.map((option) => option.value))
		expect(spanish.map((option) => option.label)).not.toEqual(english.map((option) => option.label))
		expect(SERVICE_TYPE_LABELS.general_manufacturing).toBe('Manufactura general')
		expect(formatStructureLabel('sovereignty')).toBe('Soberanía')
	})

	it('uses complete plural messages for fleet actions and scan confirmations', async () => {
		await setAppLocale('es-MX', { persistLocal: false })
		expect(i18n.t('fleetTracking.removedMembers', { count: 1 })).toBe(
			'Se quitó 1 miembro de la flota.'
		)
		expect(i18n.t('fleetTracking.removedMembers', { count: 2 })).toBe(
			'Se quitaron 2 miembros de la flota.'
		)
		expect(i18n.t('moonScan.approvedPendingScans', { count: 1 })).toBe(
			'Se aprobó 1 escaneo pendiente.'
		)
		expect(i18n.t('moonScan.approvedPendingScans', { count: 1_000_000 })).toBe(
			'Se aprobaron 1000000 escaneos pendientes.'
		)
	})
})
