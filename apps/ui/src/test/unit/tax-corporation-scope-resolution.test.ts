import { describe, expect, it } from 'vitest'

import { resolveTaxCorporationScopeRows } from '../../client/hooks/corporation-tax'

function makeRow(corporationId: string) {
	return {
		corporationId,
		included: true,
		exclusionReason: null,
		createdAt: new Date('2026-03-01T00:00:00.000Z'),
		updatedAt: new Date('2026-03-01T00:00:00.000Z'),
	}
}

describe('resolveTaxCorporationScopeRows', () => {
	it('site admins see the same global eligible corp set as tax-admin/tax-auditor users', () => {
		const globalRows = [makeRow('1001'), makeRow('1002'), makeRow('1003')]

		const siteAdmin = resolveTaxCorporationScopeRows({
			canManageGlobal: true,
			canAuditGlobal: true,
			hasScopedViewerPermissions: false,
			viewerCorporationIds: new Set(),
			globalRows,
			fallbackRows: [makeRow('2001')],
			demoRows: [],
		})
		const taxAdmin = resolveTaxCorporationScopeRows({
			canManageGlobal: true,
			canAuditGlobal: false,
			hasScopedViewerPermissions: false,
			viewerCorporationIds: new Set(),
			globalRows,
			fallbackRows: [makeRow('2001')],
			demoRows: [],
		})
		const taxAuditor = resolveTaxCorporationScopeRows({
			canManageGlobal: false,
			canAuditGlobal: true,
			hasScopedViewerPermissions: false,
			viewerCorporationIds: new Set(),
			globalRows,
			fallbackRows: [makeRow('2001')],
			demoRows: [],
		})

		expect(siteAdmin.scopeMode).toBe('admin')
		expect(taxAdmin.scopeMode).toBe('admin')
		expect(taxAuditor.scopeMode).toBe('admin')
		expect(siteAdmin.rows.map((row) => row.corporationId)).toEqual(['1001', '1002', '1003'])
		expect(taxAdmin.rows.map((row) => row.corporationId)).toEqual(['1001', '1002', '1003'])
		expect(taxAuditor.rows.map((row) => row.corporationId)).toEqual(['1001', '1002', '1003'])
	})

	it('tax-viewer URN users resolve to auditor scope and only see fallback visibility corps', () => {
		const result = resolveTaxCorporationScopeRows({
			canManageGlobal: false,
			canAuditGlobal: false,
			hasScopedViewerPermissions: true,
			viewerCorporationIds: new Set(['2200']),
			globalRows: [makeRow('1001'), makeRow('1002')],
			fallbackRows: [makeRow('2200'), makeRow('2201')],
			demoRows: [],
		})

		expect(result.scopeMode).toBe('auditor')
		expect(result.rows.map((row) => row.corporationId)).toEqual(['2200'])
	})

	it('ceo/director without URNs resolve to viewer scope and only see fallback leadership corps', () => {
		const result = resolveTaxCorporationScopeRows({
			canManageGlobal: false,
			canAuditGlobal: false,
			hasScopedViewerPermissions: false,
			viewerCorporationIds: new Set(),
			globalRows: [makeRow('1001')],
			// leadership subset from useCorporationAccess, despite broader membership
			fallbackRows: [makeRow('3300'), makeRow('3302')],
			demoRows: [],
		})

		expect(result.scopeMode).toBe('viewer')
		expect(result.rows.map((row) => row.corporationId)).toEqual(['3300', '3302'])
		expect(result.rows.map((row) => row.corporationId)).not.toContain('3301')
	})

	it('supports multi-corp visibility and leadership subsets across fallback paths', () => {
		const viewer = resolveTaxCorporationScopeRows({
			canManageGlobal: false,
			canAuditGlobal: false,
			hasScopedViewerPermissions: true,
			viewerCorporationIds: new Set(['4400', '4402']),
			globalRows: [],
			fallbackRows: [makeRow('4400'), makeRow('4401'), makeRow('4402')],
			demoRows: [],
		})
		const ceoDirector = resolveTaxCorporationScopeRows({
			canManageGlobal: false,
			canAuditGlobal: false,
			hasScopedViewerPermissions: false,
			viewerCorporationIds: new Set(),
			globalRows: [],
			fallbackRows: [makeRow('4400'), makeRow('4402')],
			demoRows: [],
		})

		expect(viewer.rows.map((row) => row.corporationId)).toEqual(['4400', '4402'])
		expect(ceoDirector.rows.map((row) => row.corporationId)).toEqual(['4400', '4402'])
	})

	it('returns only scoped viewer corporations when user can access 3 corps but has 2 viewer URNs', () => {
		const result = resolveTaxCorporationScopeRows({
			canManageGlobal: false,
			canAuditGlobal: false,
			hasScopedViewerPermissions: true,
			viewerCorporationIds: new Set(['7100', '7102']),
			globalRows: [makeRow('9000')],
			fallbackRows: [makeRow('7100'), makeRow('7101'), makeRow('7102')],
			demoRows: [],
		})

		expect(result.scopeMode).toBe('auditor')
		expect(result.rows.map((row) => row.corporationId)).toEqual(['7100', '7102'])
	})

	it('always merges demo rows into whichever source path is selected without duplicate ids', () => {
		const global = resolveTaxCorporationScopeRows({
			canManageGlobal: true,
			canAuditGlobal: false,
			hasScopedViewerPermissions: false,
			viewerCorporationIds: new Set(),
			globalRows: [makeRow('5001')],
			fallbackRows: [makeRow('6001')],
			demoRows: [makeRow('5001'), makeRow('9001')],
		})
		const viewer = resolveTaxCorporationScopeRows({
			canManageGlobal: false,
			canAuditGlobal: false,
			hasScopedViewerPermissions: true,
			viewerCorporationIds: new Set(['6001']),
			globalRows: [makeRow('5001')],
			fallbackRows: [makeRow('6001')],
			demoRows: [makeRow('6001'), makeRow('9001')],
		})

		expect(global.rows.map((row) => row.corporationId)).toEqual(['5001', '9001'])
		expect(viewer.rows.map((row) => row.corporationId)).toEqual(['6001', '9001'])
	})
})
