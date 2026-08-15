import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { getCachedCharacterPermissions, getCachedUserPermissions } from '../../lib/groups-cache'
import { buildTaxViewerScopedUrn } from '../../middleware/tax-permissions'
import corporationTaxRoutes from '../corporation-tax'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
	getCachedCharacterPermissions: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const getCachedUserPermissionsMock = vi.mocked(getCachedUserPermissions)
const getCachedCharacterPermissionsMock = vi.mocked(getCachedCharacterPermissions)

const env = {
	CORPORATION_TAX: { name: 'CORPORATION_TAX' },
	EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
	EVE_CHARACTER_DATA: { name: 'EVE_CHARACTER_DATA' },
	EVE_TOKEN_STORE: { name: 'EVE_TOKEN_STORE' },
	GROUPS: { name: 'GROUPS' },
	FEATURES: { name: 'FEATURES' },
} as any

function createApp(user?: SessionUser, db?: any) {
	const app = new Hono<{
		Bindings: any
		Variables: { user?: SessionUser; db?: any }
	}>()

	if (user || db) {
		app.use('*', async (c, next) => {
			if (user) {
				c.set('user', user)
			}
			if (db) {
				c.set('db', db)
			}
			await next()
		})
	}

	app.route('/api/corporation-tax', corporationTaxRoutes)
	return app
}

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [
			{
				id: 'char-link-1',
				characterOwnerHash: 'owner-hash-1',
				characterId: '7001',
				characterName: 'Pilot One',
				is_primary: true,
				hasValidToken: true,
			},
		],
		is_admin: false,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function makeCorporationTaxStub() {
	return {
		getHealth: vi.fn(),
		listCorporationExclusions: vi.fn(),
		upsertCorporationExclusion: vi.fn(),
		deleteCorporationExclusion: vi.fn(),
		listAuditLog: vi.fn(),
		deleteRuleGroup: vi.fn(),
		listRuleSets: vi.fn(),
		createRuleSet: vi.fn(),
		updateRuleSet: vi.fn(),
		ingestCorporationLedgerWindow: vi.fn(),
		listLedgerEntries: vi.fn(),
		listLedgerParties: vi.fn(),
		runAssessmentForPeriod: vi.fn(),
		startAssessmentWorkflow: vi.fn(),
		getAssessmentWorkflowStatus: vi.fn(),
		rebuildFinalizedRollupsForPeriod: vi.fn(),
		createBillsForAssessment: vi.fn(),
		syncAssessmentBillStatus: vi.fn(),
		issueBillsForPeriod: vi.fn(),
		getCorporationBillStatusHistory: vi.fn(),
		getAssessmentBillStatusHistory: vi.fn(),
		syncCorporationBillStatuses: vi.fn(),
		getSummaryReport: vi.fn(),
		getTotalTaxesByCorporationReport: vi.fn(),
		getTopIncomeSourcesReport: vi.fn(),
		getTopIncomeSourcesMonthlyReport: vi.fn(),
		getEssPayoutReport: vi.fn(),
		getComplianceOverTimeReport: vi.fn(),
		getTaxDiscrepancyReport: vi.fn(),
		getMissingEsiKeysReport: vi.fn(),
		getBillStatusReport: vi.fn(),
		getMemberSummaryReport: vi.fn(),
		requestExport: vi.fn(),
		listExports: vi.fn(),
		getExportById: vi.fn(),
		getExportArtifact: vi.fn(),
		createExportSchedule: vi.fn(),
		listExportSchedules: vi.fn(),
		listCorporationBillingConfigs: vi.fn(),
		createCorporationBillingConfig: vi.fn(),
		updateCorporationBillingConfig: vi.fn(),
		deleteCorporationBillingConfig: vi.fn(),
		setDefaultCorporationBillingConfig: vi.fn(),
		listAlerts: vi.fn(),
		acknowledgeAlert: vi.fn(),
		resolveAlert: vi.fn(),
		retryFailedAlertDeliveries: vi.fn(),
		upsertNotificationDestination: vi.fn(),
		listNotificationDestinations: vi.fn(),
	}
}

function routeStubs(params: {
	corporationTaxStub?: ReturnType<typeof makeCorporationTaxStub>
	featuresStub?: {
		checkFlag: ReturnType<typeof vi.fn>
	}
	corporationDataStub?: {
		getCorporationInfo: ReturnType<typeof vi.fn>
		getDirectors: ReturnType<typeof vi.fn>
		getMembers?: ReturnType<typeof vi.fn>
	}
	characterDataStub?: {
		getCharacterInfo: ReturnType<typeof vi.fn>
	}
	tokenStoreStub?: {
		searchCharacter: ReturnType<typeof vi.fn>
		resolveIds?: ReturnType<typeof vi.fn>
	}
}) {
	getStubMock.mockImplementation((binding: any) => {
		if (binding === env.CORPORATION_TAX) {
			return params.corporationTaxStub
		}
		if (binding === env.FEATURES) {
			return params.featuresStub ?? { checkFlag: vi.fn().mockResolvedValue(true) }
		}
		if (binding === env.EVE_CORPORATION_DATA) {
			return params.corporationDataStub
		}
		if (binding === env.EVE_CHARACTER_DATA) {
			return params.characterDataStub
		}
		if (binding === env.EVE_TOKEN_STORE) {
			return params.tokenStoreStub
		}
		throw new Error('Unexpected durable object binding in test')
	})
}

describe('corporation-tax routes', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.FEATURES) {
				return { checkFlag: vi.fn().mockResolvedValue(true) }
			}
			return undefined
		})
		getCachedUserPermissionsMock.mockResolvedValue([])
		getCachedCharacterPermissionsMock.mockResolvedValue([])
	})

	it('returns 401 for unauthenticated requests', async () => {
		const app = createApp()
		const response = await app.request('/api/corporation-tax/health', {}, env)

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: 'Unauthorized' })
	})

	it('returns health payload from corporation-tax worker', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		corporationTaxStub.getHealth.mockResolvedValue({ status: 'ok', service: 'corporation-tax' })
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request('/api/corporation-tax/health', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ status: 'ok', service: 'corporation-tax' })
		expect(corporationTaxStub.getHealth).toHaveBeenCalledTimes(1)
	})

	it('returns tax capabilities from URN permissions', async () => {
		const app = createApp(makeUser())
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([
			{ urn: buildTaxViewerScopedUrn('4200') },
		] as any)
		routeStubs({ featuresStub })

		const response = await app.request('/api/corporation-tax/capabilities', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			corporationId: null,
			global: {
				canRead: false,
				canAudit: false,
				canManage: false,
			},
			scoped: {
				canRead: false,
				canAudit: false,
				canManage: false,
			},
		})
	})

	it.each([
		{
			urn: buildTaxViewerScopedUrn('4200'),
			expected: { canRead: false, canAudit: false, canManage: false },
		},
		{
			urn: 'urn:tax:auditor',
			expected: { canRead: true, canAudit: true, canManage: false },
		},
		{
			urn: 'urn:tax:admin',
			expected: { canRead: true, canAudit: true, canManage: true },
		},
	])('maps %s capability levels correctly', async ({ urn, expected }) => {
		const app = createApp(makeUser())
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn }] as any)
		routeStubs({ featuresStub })

		const response = await app.request('/api/corporation-tax/capabilities', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			corporationId: null,
			global: expected,
			scoped: expected,
		})
	})

	it('returns scoped capabilities via corporation self-service fallback', async () => {
		const app = createApp(
			makeUser({
				id: 'corp-self-service-user',
				characters: [
					{
						id: 'char-link-2',
						characterOwnerHash: 'owner-hash-2',
						characterId: '9001',
						characterName: 'Director Pilot',
						is_primary: true,
						hasValidToken: true,
					},
				],
			})
		)
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		const corporationDataStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999' }),
			getDirectors: vi.fn().mockResolvedValue([{ characterId: '9001' }]),
		}
		const characterDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue({ corporationId: '4100' }),
		}
		routeStubs({ featuresStub, corporationDataStub, characterDataStub })

		const response = await app.request(
			'/api/corporation-tax/capabilities?corporationId=4100',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			corporationId: '4100',
			global: {
				canRead: false,
				canAudit: false,
				canManage: false,
			},
			scoped: {
				canRead: true,
				canAudit: false,
				canManage: false,
			},
		})
	})

	it('returns scoped viewer capabilities for own-corporation membership', async () => {
		const app = createApp(
			makeUser({
				characters: [
					{
						id: 'char-link-3',
						characterOwnerHash: 'owner-hash-3',
						characterId: '9100',
						characterName: 'Member Pilot',
						is_primary: true,
						hasValidToken: true,
					},
				],
			})
		)
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([
			{ urn: buildTaxViewerScopedUrn('4200') },
		] as any)
		const characterDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue({ corporationId: '4200' }),
		}
		routeStubs({ featuresStub, characterDataStub })

		const response = await app.request(
			'/api/corporation-tax/capabilities?corporationId=4200',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			corporationId: '4200',
			global: {
				canRead: false,
				canAudit: false,
				canManage: false,
			},
			scoped: {
				canRead: true,
				canAudit: false,
				canManage: false,
			},
		})
	})

	it('returns 404 when tax feature flag is disabled', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(false) }
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request('/api/corporation-tax/health', {}, env)

		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({ error: 'Corporation tax feature is disabled' })
		expect(corporationTaxStub.getHealth).not.toHaveBeenCalled()
	})

	it('forbids corporation list when user lacks tax permissions', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request('/api/corporation-tax/corporations', {}, env)

		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Forbidden' })
		expect(corporationTaxStub.listCorporationExclusions).not.toHaveBeenCalled()
	})

	it('validates corporation list pagination query values', async () => {
		const db = {
			query: {
				managedCorporations: {
					findMany: vi.fn(),
				},
			},
		}
		const app = createApp(makeUser(), db)
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request('/api/corporation-tax/corporations?limit=1001', {}, env)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'limit must be between 1 and 1000' })
		expect(corporationTaxStub.listCorporationExclusions).not.toHaveBeenCalled()
	})

	it('forwards corporation list request and overlays exclusions', async () => {
		const db = {
			query: {
				managedCorporations: {
					findMany: vi.fn().mockResolvedValue([
						{
							corporationId: '1002',
							isActive: true,
							isMemberCorporation: true,
							isSpecialPurpose: false,
							createdAt: new Date('2026-01-02T00:00:00.000Z'),
							updatedAt: new Date('2026-03-11T00:00:00.000Z'),
						},
						{
							corporationId: '1001',
							isActive: true,
							isMemberCorporation: true,
							isSpecialPurpose: false,
							createdAt: new Date('2026-01-01T00:00:00.000Z'),
							updatedAt: new Date('2026-03-10T00:00:00.000Z'),
						},
					]),
				},
			},
		}
		const app = createApp(makeUser(), db)
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.listCorporationExclusions.mockResolvedValue([
			{
				corporationId: '1002',
				reason: 'excluded for testing',
			},
		])
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/corporations?limit=2&offset=0',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			expect.objectContaining({
				corporationId: '1002',
				included: false,
				exclusionReason: 'excluded for testing',
			}),
			expect.objectContaining({
				corporationId: '1001',
				included: true,
				exclusionReason: null,
			}),
		])
		expect(corporationTaxStub.listCorporationExclusions).toHaveBeenCalledWith({
			limit: 500,
			offset: 0,
		})
	})

	it('searches all active corporations for billing payee selection', async () => {
		const db = {
			query: {
				managedCorporations: {
					findMany: vi.fn().mockResolvedValue([
						{ corporationId: '1001', name: 'Acme Logistics' },
						{ corporationId: '1002', name: 'Stellar Forge' },
					]),
				},
			},
		}
		const app = createApp(makeUser(), db)
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ featuresStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/1001/payee-corporations/search?q=ac',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			{ corporationId: '1001', name: 'Acme Logistics' },
			{ corporationId: '1002', name: 'Stellar Forge' },
		])
		expect(db.query.managedCorporations.findMany).toHaveBeenCalledTimes(1)
	})

	it('rejects billing config create when character payee selection is invalid', async () => {
		const db = {
			query: {
				userCharacters: {
					findFirst: vi.fn().mockResolvedValue(undefined),
				},
				managedCorporations: {
					findFirst: vi.fn(),
				},
			},
		}
		const app = createApp(makeUser(), db)
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/1001/billing-configs',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					billingEnabled: true,
					billingPayeeType: 'character',
					billingPayeeId: '99999999',
					billingDueDays: 14,
				}),
			},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'Selected character payee was not found' })
		expect(corporationTaxStub.createCorporationBillingConfig).not.toHaveBeenCalled()
	})

	it('validates exclusion upsert payload', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/exclusions/3001',
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'reason is required' })
		expect(corporationTaxStub.upsertCorporationExclusion).not.toHaveBeenCalled()
	})

	it('forwards valid exclusion upsert to RPC', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.upsertCorporationExclusion.mockResolvedValue({
			corporationId: '3002',
			reason: 'legacy carve-out',
		})
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/exclusions/3002',
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					reason: 'legacy carve-out',
				}),
			},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			corporationId: '3002',
			reason: 'legacy carve-out',
		})
		expect(corporationTaxStub.upsertCorporationExclusion).toHaveBeenCalledWith(user.id, '3002', {
			reason: 'legacy carve-out',
		})
	})

	it('creates global tax rule sets for tax admin role', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.createRuleSet.mockResolvedValue({
			id: 'rule-1',
			ruleGroupId: 'group-default',
			name: 'Global Rule',
		})
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/rules',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ruleGroupId: 'group-default',
					name: 'Global Rule',
					taxRateBps: 750,
					label: 'Default tax rate',
				}),
			},
			env
		)

		expect(response.status).toBe(201)
		expect(await response.json()).toEqual({
			id: 'rule-1',
			ruleGroupId: 'group-default',
			name: 'Global Rule',
		})
		expect(corporationTaxStub.createRuleSet).toHaveBeenCalledWith(
			user.id,
			expect.objectContaining({
				ruleGroupId: 'group-default',
				name: 'Global Rule',
			})
		)
	})

	it('rejects create rule when priority is out of bounds', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/rules',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ruleGroupId: 'group-default',
					name: 'Global Rule',
					priority: 101,
					taxRateBps: 750,
					label: 'Default tax rate',
				}),
			},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'priority must be an integer between 0 and 100',
		})
		expect(corporationTaxStub.createRuleSet).not.toHaveBeenCalled()
	})

	it('rejects update rule when priority is out of bounds', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/rules/rule-1',
			{
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					priority: -1,
				}),
			},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'priority must be an integer between 0 and 100',
		})
		expect(corporationTaxStub.updateRuleSet).not.toHaveBeenCalled()
	})

	it('returns 409 when deleting a protected default rule group', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.deleteRuleGroup.mockRejectedValue(
			new Error('Default global rule group cannot be deleted')
		)
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/rule-groups/group-default',
			{ method: 'DELETE' },
			env
		)

		expect(response.status).toBe(409)
		expect(await response.json()).toEqual({
			error: 'Default global rule group cannot be deleted',
		})
	})

	it('validates assessment period ordering for run endpoint', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/4001/assessments/run',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					periodStart: '2026-03-05T00:00:00.000Z',
					periodEnd: '2026-03-01T00:00:00.000Z',
				}),
			},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'periodStart must be before periodEnd' })
		expect(corporationTaxStub.runAssessmentForPeriod).not.toHaveBeenCalled()
	})

	it('queues run-assessment payload as parsed dates', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.startAssessmentWorkflow.mockResolvedValue({
			workflowInstanceId: 'tax-assessment-4002-run-1',
			corporationId: '4002',
			periodStart: '2026-03-01T00:00:00.000Z',
			periodEnd: '2026-03-31T00:00:00.000Z',
			status: 'queued',
		})
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/4002/assessments/run',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					periodStart: '2026-03-01T00:00:00.000Z',
					periodEnd: '2026-03-31T00:00:00.000Z',
				}),
			},
			env
		)

		expect(response.status).toBe(202)
		expect(await response.json()).toEqual({
			workflowInstanceId: 'tax-assessment-4002-run-1',
			corporationId: '4002',
			periodStart: '2026-03-01T00:00:00.000Z',
			periodEnd: '2026-03-31T00:00:00.000Z',
			status: 'queued',
		})
		expect(corporationTaxStub.startAssessmentWorkflow).toHaveBeenCalledTimes(1)

		const [actorUserId, payload] = corporationTaxStub.startAssessmentWorkflow.mock.calls[0]
		expect(actorUserId).toBe(user.id)
		expect(payload.corporationId).toBe('4002')
		expect(payload.periodStart).toBeInstanceOf(Date)
		expect(payload.periodStart.toISOString()).toBe('2026-03-01T00:00:00.000Z')
		expect(payload.periodEnd).toBeInstanceOf(Date)
		expect(payload.periodEnd.toISOString()).toBe('2026-03-31T00:00:00.000Z')
	})

	it('forwards rebuild-finalized payload as parsed dates', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.rebuildFinalizedRollupsForPeriod.mockResolvedValue({
			assessment: { id: 'assessment-closed-1' },
		})
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/4002/assessments/rebuild-finalized',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					periodStart: '2026-02-01T00:00:00.000Z',
					periodEnd: '2026-02-28T23:59:59.999Z',
				}),
			},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ assessment: { id: 'assessment-closed-1' } })
		expect(corporationTaxStub.rebuildFinalizedRollupsForPeriod).toHaveBeenCalledTimes(1)

		const [actorUserId, payload] = corporationTaxStub.rebuildFinalizedRollupsForPeriod.mock.calls[0]
		expect(actorUserId).toBe(user.id)
		expect(payload.corporationId).toBe('4002')
		expect(payload.periodStart).toBeInstanceOf(Date)
		expect(payload.periodStart.toISOString()).toBe('2026-02-01T00:00:00.000Z')
		expect(payload.periodEnd).toBeInstanceOf(Date)
		expect(payload.periodEnd.toISOString()).toBe('2026-02-28T23:59:59.999Z')
	})

	it('maps rebuild-finalized open-period error to 409', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const featuresStub = { checkFlag: vi.fn().mockResolvedValue(true) }
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.rebuildFinalizedRollupsForPeriod.mockRejectedValue(
			new Error('Finalized rollup rebuild requires a closed period')
		)
		routeStubs({ corporationTaxStub, featuresStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/4002/assessments/rebuild-finalized',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					periodStart: '2026-03-01T00:00:00.000Z',
					periodEnd: '2026-03-31T23:59:59.999Z',
				}),
			},
			env
		)

		expect(response.status).toBe(409)
		expect(await response.json()).toEqual({
			error: 'Finalized rollup rebuild requires a closed period',
		})
	})

	it('validates ledger sourceTypes query values', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/4002/ledger/entries?sourceTypes=bad_source',
			{},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error:
				'sourceTypes must only include corporation_wallet_journal, corporation_wallet_transaction, character_wallet_journal, character_wallet_transaction',
		})
		expect(corporationTaxStub.listLedgerEntries).not.toHaveBeenCalled()
	})

	it('forwards ledger entry filters including sourceTypes and characterId', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.listLedgerEntries.mockResolvedValue({
			rows: [{ id: 'ledger-1' }],
			totalRows: 1,
		})
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/4002/ledger/entries?sourceTypes=character_wallet_journal,character_wallet_transaction&characterId=7001&refTypes=market_transaction&fromDate=2026-03-01T00:00:00.000Z&toDate=2026-03-31T23:59:59.999Z&limit=20&offset=3',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ rows: [{ id: 'ledger-1' }], totalRows: 1 })
		expect(corporationTaxStub.listLedgerEntries).toHaveBeenCalledWith('4002', {
			division: undefined,
			sourceTypes: ['character_wallet_journal', 'character_wallet_transaction'],
			characterId: '7001',
			refTypes: ['market_transaction'],
			firstPartyId: undefined,
			secondPartyId: undefined,
			fromDate: new Date('2026-03-01T00:00:00.000Z'),
			toDate: new Date('2026-03-31T23:59:59.999Z'),
			minAmount: undefined,
			maxAmount: undefined,
			limit: 20,
			offset: 3,
			sortBy: undefined,
			sortDir: 'desc',
		})
	})

	it('validates ledger parties date bounds', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/4002/ledger/parties?fromDate=2026-03-31T23:59:59.999Z&toDate=2026-03-01T00:00:00.000Z',
			{},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'fromDate must be before or equal to toDate',
		})
		expect(corporationTaxStub.listLedgerParties).not.toHaveBeenCalled()
	})

	it('returns ledger parties with resolved names', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const tokenStoreStub = {
			searchCharacter: vi.fn(),
			resolveIds: vi.fn().mockResolvedValue({
				'9001': 'Ariadne Voss',
				'9002': 'Talon Mere',
			}),
		}
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.listLedgerParties.mockResolvedValue([
			{
				entityId: '9001',
				senderCount: 3,
				recipientCount: 1,
				lastSeenAt: new Date('2026-03-20T00:00:00.000Z'),
			},
			{
				entityId: '9002',
				senderCount: 0,
				recipientCount: 4,
				lastSeenAt: new Date('2026-03-19T00:00:00.000Z'),
			},
		])
		routeStubs({ corporationTaxStub, tokenStoreStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/4002/ledger/parties?fromDate=2026-03-01T00:00:00.000Z&toDate=2026-03-31T23:59:59.999Z&limit=25',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			{
				entityId: '9001',
				entityName: 'Ariadne Voss',
				lastSeenAt: '2026-03-20T00:00:00.000Z',
			},
			{
				entityId: '9002',
				entityName: 'Talon Mere',
				lastSeenAt: '2026-03-19T00:00:00.000Z',
			},
		])
		expect(corporationTaxStub.listLedgerParties).toHaveBeenCalledWith('4002', {
			fromDate: new Date('2026-03-01T00:00:00.000Z'),
			toDate: new Date('2026-03-31T23:59:59.999Z'),
			limit: 2000,
		})
		expect(tokenStoreStub.resolveIds).toHaveBeenCalledWith(['9001', '9002'])
	})

	it('filters ledger parties by query using resolved names', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const tokenStoreStub = {
			searchCharacter: vi.fn(),
			resolveIds: vi.fn().mockResolvedValue({
				'9001': 'Ariadne Voss',
				'9002': 'Talon Mere',
			}),
		}
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.listLedgerParties.mockResolvedValue([
			{
				entityId: '9001',
				senderCount: 3,
				recipientCount: 1,
				lastSeenAt: new Date('2026-03-20T00:00:00.000Z'),
			},
			{
				entityId: '9002',
				senderCount: 0,
				recipientCount: 4,
				lastSeenAt: new Date('2026-03-19T00:00:00.000Z'),
			},
		])
		routeStubs({ corporationTaxStub, tokenStoreStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/4002/ledger/parties?q=tal&limit=10',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			{
				entityId: '9002',
				entityName: 'Talon Mere',
				lastSeenAt: '2026-03-19T00:00:00.000Z',
			},
		])
		expect(corporationTaxStub.listLedgerParties).toHaveBeenCalledWith('4002', {
			fromDate: undefined,
			toDate: undefined,
			limit: 2000,
		})
	})

	it('returns corporation bill history for auditor role', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		corporationTaxStub.getCorporationBillStatusHistory.mockResolvedValue({
			items: [{ assessmentId: 'a-1', billStatus: 'issued' }],
			total: 1,
		})
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/5001/bills/history?limit=10&offset=3',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			items: [{ assessmentId: 'a-1', billStatus: 'issued' }],
			total: 1,
		})
		expect(corporationTaxStub.getCorporationBillStatusHistory).toHaveBeenCalledWith('5001', 10, 3)
	})

	it('maps known billing domain errors to 4xx when creating assessment bills', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.createBillsForAssessment.mockRejectedValue(
			new Error('Only corporation-scope assessments can be billed')
		)
		routeStubs({ corporationTaxStub })

		const badScopeResponse = await app.request(
			'/api/corporation-tax/corporations/5001/assessments/assessment-1/bills',
			{ method: 'POST' },
			env
		)
		expect(badScopeResponse.status).toBe(400)
		expect(await badScopeResponse.json()).toEqual({
			error: 'Only corporation-scope assessments can be billed',
		})

		corporationTaxStub.createBillsForAssessment.mockRejectedValue(new Error('Assessment not found'))
		const notFoundResponse = await app.request(
			'/api/corporation-tax/corporations/5001/assessments/assessment-404/bills',
			{ method: 'POST' },
			env
		)
		expect(notFoundResponse.status).toBe(404)
		expect(await notFoundResponse.json()).toEqual({ error: 'Assessment not found' })
	})

	it('maps known billing domain errors to 4xx when issuing period bills', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.issueBillsForPeriod.mockRejectedValue(
			new Error('Default billing configuration not found for this corporation')
		)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/5001/periods/issue-bills',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					periodStart: '2026-03-01T00:00:00.000Z',
					periodEnd: '2026-03-31T23:59:59.999Z',
				}),
			},
			env
		)

		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({
			error: 'Default billing configuration not found for this corporation',
		})
	})

	it('validates bulk bill sync limit and forwards valid requests', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.syncCorporationBillStatuses.mockResolvedValue({
			synced: 2,
			updatedAssessments: 1,
		})
		routeStubs({ corporationTaxStub })

		const invalidResponse = await app.request(
			'/api/corporation-tax/corporations/6001/bills/sync',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ limit: 251 }),
			},
			env
		)

		expect(invalidResponse.status).toBe(400)
		expect(await invalidResponse.json()).toEqual({
			error: 'limit must be an integer between 1 and 250',
		})
		expect(corporationTaxStub.syncCorporationBillStatuses).not.toHaveBeenCalled()

		const validResponse = await app.request(
			'/api/corporation-tax/corporations/6001/bills/sync',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ limit: 100 }),
			},
			env
		)

		expect(validResponse.status).toBe(200)
		expect(await validResponse.json()).toEqual({ synced: 2, updatedAssessments: 1 })
		expect(corporationTaxStub.syncCorporationBillStatuses).toHaveBeenCalledWith(
			user.id,
			'6001',
			100
		)
	})

	it('forwards summary report filters with parsed dates', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		corporationTaxStub.getSummaryReport.mockResolvedValue({
			corporationId: '7001',
			assessmentCount: 2,
		})
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/summary?corporationId=7001&fromDate=2026-03-01T00:00:00.000Z&toDate=2026-03-31T00:00:00.000Z&limit=25&offset=5',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			corporationId: '7001',
			assessmentCount: 2,
		})
		expect(corporationTaxStub.getSummaryReport).toHaveBeenCalledTimes(1)
		const [filters] = corporationTaxStub.getSummaryReport.mock.calls[0]
		expect(filters.corporationId).toBe('7001')
		expect(filters.fromDate).toBeInstanceOf(Date)
		expect(filters.fromDate.toISOString()).toBe('2026-03-01T00:00:00.000Z')
		expect(filters.toDate).toBeInstanceOf(Date)
		expect(filters.toDate.toISOString()).toBe('2026-03-31T00:00:00.000Z')
		expect(filters.limit).toBe(25)
		expect(filters.offset).toBe(5)
	})

	it('rejects invalid summary report date query', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/summary?fromDate=not-a-date',
			{},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'fromDate must be a valid ISO date string',
		})
		expect(corporationTaxStub.getSummaryReport).not.toHaveBeenCalled()
	})

	it('forwards total taxes report pagination and sort filters', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		corporationTaxStub.getTotalTaxesByCorporationReport.mockResolvedValue([
			{ corporationId: '7001' },
		])
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/total-taxes?corporationId=7001&limit=25&offset=50&sortBy=taxDue&sortDir=asc',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([{ corporationId: '7001' }])
		expect(corporationTaxStub.getTotalTaxesByCorporationReport).toHaveBeenCalledWith(
			expect.objectContaining({
				corporationId: '7001',
				fromDate: undefined,
				toDate: undefined,
				limit: 25,
				offset: 50,
				sortBy: 'taxDue',
				sortDirection: 'asc',
			})
		)
	})

	it('rejects invalid total taxes report sort field', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/total-taxes?sortBy=invalid',
			{},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error:
				'sortBy must be one of: corporationId, taxableItemCount, assessmentCount, taxDue, taxPaid, taxDelta, lastAssessmentAt',
		})
		expect(corporationTaxStub.getTotalTaxesByCorporationReport).not.toHaveBeenCalled()
	})

	it('forwards ESS report pagination and sort filters', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		corporationTaxStub.getEssPayoutReport.mockResolvedValue([{ id: 'ess-1' }])
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/ess?corporationId=7001&limit=10&offset=20&sortBy=amount&sortDir=asc',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([{ id: 'ess-1' }])
		expect(corporationTaxStub.getEssPayoutReport).toHaveBeenCalledWith(
			expect.objectContaining({
				corporationId: '7001',
				fromDate: undefined,
				toDate: undefined,
				limit: 10,
				offset: 20,
				sortBy: 'amount',
				sortDirection: 'asc',
			})
		)
	})

	it('forwards rollup-focused report filters to top-income report', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		corporationTaxStub.getTopIncomeSourcesReport.mockResolvedValue([{ refType: 'bounty_prizes' }])
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/top-income?corporationId=7001&fromDate=2026-03-01T00:00:00.000Z&toDate=2026-03-31T23:59:59.000Z',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([{ refType: 'bounty_prizes' }])
		expect(corporationTaxStub.getTopIncomeSourcesReport).toHaveBeenCalledWith(
			expect.objectContaining({
				corporationId: '7001',
				fromDate: new Date('2026-03-01T00:00:00.000Z'),
				toDate: new Date('2026-03-31T23:59:59.000Z'),
			})
		)
	})

	it('forwards rollup-focused report filters to monthly top-income report', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		corporationTaxStub.getTopIncomeSourcesMonthlyReport.mockResolvedValue([
			{ monthStart: '2026-03-01T00:00:00.000Z', refType: 'bounty_prizes' },
		])
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/top-income-monthly?corporationId=7001&fromDate=2026-03-01T00:00:00.000Z&toDate=2026-03-31T23:59:59.000Z',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			{ monthStart: '2026-03-01T00:00:00.000Z', refType: 'bounty_prizes' },
		])
		expect(corporationTaxStub.getTopIncomeSourcesMonthlyReport).toHaveBeenCalledWith(
			expect.objectContaining({
				corporationId: '7001',
				fromDate: new Date('2026-03-01T00:00:00.000Z'),
				toDate: new Date('2026-03-31T23:59:59.000Z'),
			})
		)
	})

	it('rejects invalid ESS report sort field', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request('/api/corporation-tax/reports/ess?sortBy=bad_field', {}, env)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'sortBy must be one of: entryDate, amount, corporationId, division',
		})
		expect(corporationTaxStub.getEssPayoutReport).not.toHaveBeenCalled()
	})

	it('rejects invalid ESS report sort direction', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request('/api/corporation-tax/reports/ess?sortDir=up', {}, env)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: "sortDir must be 'asc' or 'desc'",
		})
		expect(corporationTaxStub.getEssPayoutReport).not.toHaveBeenCalled()
	})

	it('forwards discrepancy report filters with parsed dates', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		corporationTaxStub.getTaxDiscrepancyReport.mockResolvedValue([{ id: 'disc-1' }])
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/discrepancies?corporationId=7001&fromDate=2026-03-01T00:00:00.000Z&toDate=2026-03-31T23:59:59.999Z&onlyOpen=true&limit=20&offset=2',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([{ id: 'disc-1' }])
		expect(corporationTaxStub.getTaxDiscrepancyReport).toHaveBeenCalledWith({
			corporationId: '7001',
			fromDate: new Date('2026-03-01T00:00:00.000Z'),
			toDate: new Date('2026-03-31T23:59:59.999Z'),
			onlyOpen: true,
			limit: 20,
			offset: 2,
			sortBy: undefined,
			sortDirection: undefined,
		})
	})

	it('rejects invalid discrepancy report date query', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/discrepancies?fromDate=not-a-date',
			{},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'fromDate must be a valid ISO date string',
		})
		expect(corporationTaxStub.getTaxDiscrepancyReport).not.toHaveBeenCalled()
	})

	it('rejects invalid discrepancy sort field', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/discrepancies?sortBy=bad_field',
			{},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'sortBy must be one of: createdAt, severity, discrepancyType, corporationId',
		})
		expect(corporationTaxStub.getTaxDiscrepancyReport).not.toHaveBeenCalled()
	})

	it('rejects invalid discrepancy sort direction', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/discrepancies?sortDir=invalid',
			{},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: "sortDir must be 'asc' or 'desc'",
		})
		expect(corporationTaxStub.getTaxDiscrepancyReport).not.toHaveBeenCalled()
	})

	it('returns missing ESI keys report for auditor role', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		corporationTaxStub.getMissingEsiKeysReport.mockResolvedValue([
			{ corporationId: '8888', hasRequiredScopes: false },
		])
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/missing-esi-keys?limit=20&offset=1',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([{ corporationId: '8888', hasRequiredScopes: false }])
		expect(corporationTaxStub.getMissingEsiKeysReport).toHaveBeenCalledWith({
			limit: 20,
			offset: 1,
			sortBy: undefined,
			sortDirection: undefined,
		})
	})

	it('forwards missing ESI report sort filters', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		corporationTaxStub.getMissingEsiKeysReport.mockResolvedValue([{ corporationId: '9999' }])
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/missing-esi-keys?sortBy=directorCount&sortDir=asc&limit=5&offset=10',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([{ corporationId: '9999' }])
		expect(corporationTaxStub.getMissingEsiKeysReport).toHaveBeenCalledWith({
			limit: 5,
			offset: 10,
			sortBy: 'directorCount',
			sortDirection: 'asc',
		})
	})

	it('rejects invalid missing ESI sort field', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/reports/missing-esi-keys?sortBy=nope',
			{},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error:
				'sortBy must be one of: corporationId, directorCount, healthyDirectorCount, lastVerified',
		})
		expect(corporationTaxStub.getMissingEsiKeysReport).not.toHaveBeenCalled()
	})

	it('rejects export requests with invalid format', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/exports',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					format: 'pdf',
					reportType: 'summary',
				}),
			},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: "format must be 'csv' or 'xlsx'" })
		expect(corporationTaxStub.requestExport).not.toHaveBeenCalled()
	})

	it('creates export requests for admin role', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.requestExport.mockResolvedValue({
			id: 'export-1',
			status: 'completed',
		})
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/exports',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					corporationId: '1234',
					format: 'csv',
					reportType: 'summary',
					filters: { fromDate: '2026-03-01T00:00:00.000Z' },
					sourceEsiVersion: 'esi-v1',
				}),
			},
			env
		)

		expect(response.status).toBe(201)
		expect(await response.json()).toEqual({
			id: 'export-1',
			status: 'completed',
		})
		expect(corporationTaxStub.requestExport).toHaveBeenCalledWith(user.id, {
			corporationId: '1234',
			format: 'csv',
			reportType: 'summary',
			filters: { fromDate: '2026-03-01T00:00:00.000Z' },
			sourceEsiVersion: 'esi-v1',
		})
	})

	it('forbids export artifact download when user lacks tax read permissions', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		corporationTaxStub.getExportById.mockResolvedValue({
			id: 'export-1',
			corporationId: '1234',
		})
		const corporationDataStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999' }),
			getDirectors: vi.fn().mockResolvedValue([]),
		}
		const characterDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue({ corporationId: '0000' }),
		}
		routeStubs({ corporationTaxStub, corporationDataStub, characterDataStub })

		const response = await app.request('/api/corporation-tax/exports/export-1/artifact', {}, env)

		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Forbidden' })
		expect(corporationTaxStub.getExportArtifact).not.toHaveBeenCalled()
	})

	it('returns export artifact for auditor role', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		corporationTaxStub.getExportById.mockResolvedValue({
			id: 'export-1',
			corporationId: '1234',
			status: 'completed',
		})
		corporationTaxStub.getExportArtifact.mockResolvedValue({
			exportId: 'export-1',
			corporationId: '1234',
			reportType: 'summary',
			requestedFormat: 'csv',
			deliveredFormat: 'csv',
			fileName: 'tax-summary-2026-03-11.csv',
			contentType: 'text/csv; charset=utf-8',
			contentBase64: 'Y29sMSxjb2wyCmExLGIy',
			rowCount: 1,
			generatedAt: '2026-03-11T00:00:00.000Z',
			note: null,
		})
		routeStubs({ corporationTaxStub })

		const response = await app.request('/api/corporation-tax/exports/export-1/artifact', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			exportId: 'export-1',
			corporationId: '1234',
			reportType: 'summary',
			requestedFormat: 'csv',
			deliveredFormat: 'csv',
			fileName: 'tax-summary-2026-03-11.csv',
			contentType: 'text/csv; charset=utf-8',
			contentBase64: 'Y29sMSxjb2wyCmExLGIy',
			rowCount: 1,
			generatedAt: '2026-03-11T00:00:00.000Z',
			note: null,
		})
		expect(corporationTaxStub.getExportById).toHaveBeenCalledWith('export-1')
		expect(corporationTaxStub.getExportArtifact).toHaveBeenCalledWith('export-1')
	})

	it('lists export schedules for auditor role', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:auditor' }] as any)
		corporationTaxStub.listExportSchedules.mockResolvedValue([{ id: 'sched-1', name: 'Weekly' }])
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/export-schedules?corporationId=1234&activeOnly=true&limit=25&offset=2',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([{ id: 'sched-1', name: 'Weekly' }])
		expect(corporationTaxStub.listExportSchedules).toHaveBeenCalledWith({
			corporationId: '1234',
			activeOnly: true,
			limit: 25,
			offset: 2,
		})
	})

	it('lists alerts for admin role', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.listAlerts.mockResolvedValue([{ id: 'alert-1', status: 'open' }])
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/alerts?corporationId=1234&status=open&severity=warning&limit=20&offset=4',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([{ id: 'alert-1', status: 'open' }])
		expect(corporationTaxStub.listAlerts).toHaveBeenCalledWith({
			corporationId: '1234',
			status: 'open',
			severity: 'warning',
			limit: 20,
			offset: 4,
		})
	})

	it('hides technical alerts for non-site-admin users', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.listAlerts.mockResolvedValue([
			{ id: 'alert-1', status: 'open', alertType: 'tax_discrepancy_threshold_exceeded' },
			{ id: 'alert-2', status: 'open', alertType: 'scheduled_operations_failed' },
			{ id: 'alert-3', status: 'open', alertType: 'discord_delivery_failed' },
			{ id: 'alert-4', status: 'open', alertType: 'ess_duplicate_records_detected' },
			{ id: 'alert-5', status: 'open', alertType: 'ess_missing_records_detected' },
			{ id: 'alert-6', status: 'open', alertType: 'scheduled_export_failed' },
		])
		routeStubs({ corporationTaxStub })

		const response = await app.request('/api/corporation-tax/alerts', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			{ id: 'alert-1', status: 'open', alertType: 'tax_discrepancy_threshold_exceeded' },
		])
	})

	it('shows technical alerts for site admins', async () => {
		const app = createApp(makeUser({ is_admin: true }))
		const corporationTaxStub = makeCorporationTaxStub()
		corporationTaxStub.listAlerts.mockResolvedValue([
			{ id: 'alert-1', status: 'open', alertType: 'tax_discrepancy_threshold_exceeded' },
			{ id: 'alert-2', status: 'open', alertType: 'scheduled_operations_failed' },
			{ id: 'alert-3', status: 'open', alertType: 'discord_delivery_failed' },
			{ id: 'alert-4', status: 'open', alertType: 'ess_duplicate_records_detected' },
			{ id: 'alert-5', status: 'open', alertType: 'ess_missing_records_detected' },
			{ id: 'alert-6', status: 'open', alertType: 'scheduled_export_failed' },
		])
		routeStubs({ corporationTaxStub })

		const response = await app.request('/api/corporation-tax/alerts', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			{ id: 'alert-1', status: 'open', alertType: 'tax_discrepancy_threshold_exceeded' },
			{ id: 'alert-2', status: 'open', alertType: 'scheduled_operations_failed' },
			{ id: 'alert-3', status: 'open', alertType: 'discord_delivery_failed' },
			{ id: 'alert-4', status: 'open', alertType: 'ess_duplicate_records_detected' },
			{ id: 'alert-5', status: 'open', alertType: 'ess_missing_records_detected' },
			{ id: 'alert-6', status: 'open', alertType: 'scheduled_export_failed' },
		])
	})

	it('acknowledges alerts for admin role', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.acknowledgeAlert.mockResolvedValue({
			id: 'alert-2',
			status: 'acknowledged',
		})
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/alerts/alert-2/acknowledge',
			{ method: 'POST' },
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			id: 'alert-2',
			status: 'acknowledged',
		})
		expect(corporationTaxStub.acknowledgeAlert).toHaveBeenCalledWith(user.id, 'alert-2')
	})

	it('forbids retry failed deliveries for non-site-admin users', async () => {
		const user = makeUser()
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/alerts/retry-failed-deliveries',
			{ method: 'POST' },
			env
		)

		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Forbidden' })
		expect(corporationTaxStub.retryFailedAlertDeliveries).not.toHaveBeenCalled()
	})

	it('allows retry failed deliveries for site admins', async () => {
		const user = makeUser({ is_admin: true })
		const app = createApp(user)
		const corporationTaxStub = makeCorporationTaxStub()
		corporationTaxStub.retryFailedAlertDeliveries.mockResolvedValue(4)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/alerts/retry-failed-deliveries',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ limit: 25 }),
			},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ retried: 4 })
		expect(corporationTaxStub.retryFailedAlertDeliveries).toHaveBeenCalledWith(user.id, 25)
	})

	it('returns member summary for in-corporation member', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const characterDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue({ characterId: '7001', corporationId: '1234' }),
		}
		corporationTaxStub.getMemberSummaryReport.mockResolvedValue([
			{ corporationId: '1234', characterId: '7001', assessmentCount: 1 },
		])
		routeStubs({ corporationTaxStub, characterDataStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/1234/member-summary?fromDate=2026-03-01T00:00:00.000Z&toDate=2026-03-31T23:59:59.999Z&topRefTypesLimit=3&refTypes=bounty_prizes,ess_escrow_transfer',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			{ corporationId: '1234', characterId: '7001', assessmentCount: 1 },
		])
		expect(corporationTaxStub.getMemberSummaryReport).toHaveBeenCalledWith({
			corporationId: '1234',
			characterIds: ['7001'],
			refTypes: ['bounty_prizes', 'ess_escrow_transfer'],
			fromDate: new Date('2026-03-01T00:00:00.000Z'),
			toDate: new Date('2026-03-31T23:59:59.999Z'),
			topRefTypesLimit: 3,
		})
	})

	it('returns member summary for regular members without settings gate', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const characterDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue({ characterId: '7001', corporationId: '1234' }),
		}
		corporationTaxStub.getMemberSummaryReport.mockResolvedValue([
			{ corporationId: '1234', characterId: '7001', assessmentCount: 1 },
		])
		routeStubs({ corporationTaxStub, characterDataStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/1234/member-summary',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			{ corporationId: '1234', characterId: '7001', assessmentCount: 1 },
		])
		expect(corporationTaxStub.getMemberSummaryReport).toHaveBeenCalledWith({
			corporationId: '1234',
			characterIds: ['7001'],
			refTypes: undefined,
			fromDate: undefined,
			toDate: undefined,
			topRefTypesLimit: undefined,
		})
	})

	it('forbids member summary lookups for a different character without tax scope permissions', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const characterDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue({ characterId: '7001', corporationId: '1234' }),
		}
		routeStubs({ corporationTaxStub, characterDataStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/1234/member-summary?characterId=9999',
			{},
			env
		)

		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Forbidden' })
		expect(corporationTaxStub.getMemberSummaryReport).not.toHaveBeenCalled()
	})

	it('resolves member summary character name search from corporation membership, including unlinked members', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		const corporationDataStub = {
			getCorporationInfo: vi.fn(),
			getDirectors: vi.fn(),
			getMembers: vi.fn().mockResolvedValue([{ characterId: '7001' }, { characterId: '81234567' }]),
		}
		const characterDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue({ characterId: '7001', corporationId: '1234' }),
		}
		const tokenStoreStub = {
			searchCharacter: vi.fn().mockResolvedValue(['81234567', '99999999']),
		}
		corporationTaxStub.getMemberSummaryReport.mockResolvedValue([
			{ corporationId: '1234', characterId: '81234567', assessmentCount: 1 },
		])
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ corporationTaxStub, corporationDataStub, characterDataStub, tokenStoreStub })

		const response = await app.request(
			'/api/corporation-tax/corporations/1234/member-summary?character=zen',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			{ corporationId: '1234', characterId: '81234567', assessmentCount: 1 },
		])
		expect(tokenStoreStub.searchCharacter).toHaveBeenCalledWith('zen', false)
		expect(corporationTaxStub.getMemberSummaryReport).toHaveBeenCalledWith({
			corporationId: '1234',
			characterIds: ['81234567'],
			refTypes: undefined,
			fromDate: undefined,
			toDate: undefined,
			topRefTypesLimit: undefined,
		})
	})

	it('forbids audit log listing when user lacks tax admin permission', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([
			{ urn: buildTaxViewerScopedUrn('4200') },
		] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request('/api/corporation-tax/audit-log', {}, env)

		expect(response.status).toBe(403)
		expect(await response.json()).toEqual({ error: 'Forbidden' })
		expect(corporationTaxStub.listAuditLog).not.toHaveBeenCalled()
	})

	it('lists audit log entries for tax admin and forwards filters', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		corporationTaxStub.listAuditLog.mockResolvedValue([
			{
				id: 'audit-1',
				corporationId: '1234',
				action: 'tax.settings.updated',
			},
		])
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/audit-log?corporationId=1234&actorUserId=user-1&action=tax.settings.updated&fromDate=2026-03-01T00:00:00.000Z&toDate=2026-03-31T00:00:00.000Z&limit=20&offset=2',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual([
			{
				id: 'audit-1',
				corporationId: '1234',
				action: 'tax.settings.updated',
			},
		])
		expect(corporationTaxStub.listAuditLog).toHaveBeenCalledWith({
			corporationId: '1234',
			actorUserId: 'user-1',
			action: 'tax.settings.updated',
			fromDate: new Date('2026-03-01T00:00:00.000Z'),
			toDate: new Date('2026-03-31T00:00:00.000Z'),
			limit: 20,
			offset: 2,
		})
	})

	it('validates notification destination snowflake values', async () => {
		const app = createApp(makeUser())
		const corporationTaxStub = makeCorporationTaxStub()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:tax:admin' }] as any)
		routeStubs({ corporationTaxStub })

		const response = await app.request(
			'/api/corporation-tax/notification-destinations',
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'Alliance Tax Alerts',
					guildId: 'not-snowflake',
					channelId: '123456789012345678',
				}),
			},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'guildId must be a valid Discord snowflake',
		})
		expect(corporationTaxStub.upsertNotificationDestination).not.toHaveBeenCalled()
	})
})
