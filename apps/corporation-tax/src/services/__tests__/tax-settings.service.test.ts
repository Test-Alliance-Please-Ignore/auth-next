import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TaxSettingsService } from '../tax-settings.service'

const getStubMock = vi.fn()

vi.mock('@repo/do-utils', () => ({
	getStub: (...args: unknown[]) => getStubMock(...args),
}))

function createSettingsRow(overrides: Record<string, unknown> = {}) {
	return {
		corporationId: '98000001',
		included: false,
		exclusionReason: null,
		defaultRateBps: 750,
		essRateBps: 1000,
		discrepancyThresholdBps: 500,
		memberSummaryEnabled: false,
		billingEnabled: false,
		billingIssuerUserId: null,
		billingPayeeId: null,
		billingPayeeType: null,
		billingDueDays: 14,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	}
}

describe('TaxSettingsService', () => {
	let mockDb: any

	beforeEach(() => {
		vi.clearAllMocks()
		mockDb = {
			query: {
				taxCorporationSettings: {
					findFirst: vi.fn(),
					findMany: vi.fn(),
				},
			},
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(() => Promise.resolve([createSettingsRow({ included: true })])),
					})),
				})),
			})),
			insert: vi.fn(() => ({
				values: vi.fn(() => ({
					returning: vi.fn(() => Promise.resolve([createSettingsRow()])),
				})),
			})),
		}
	})

	it('rejects inclusion when corp wallet scope is missing', async () => {
		mockDb.query.taxCorporationSettings.findFirst.mockResolvedValue(createSettingsRow())
		getStubMock.mockReturnValue({
			getCorporationAuthStatus: vi.fn().mockResolvedValue({
				corporationId: '98000001',
				isConfigured: true,
				isVerified: true,
				lastVerified: new Date('2026-01-01T00:00:00.000Z'),
				directorCount: 1,
				healthyDirectorCount: 1,
				requiredScopes: ['esi-wallet.read_corporation_wallets.v1'],
				missingRequiredScopes: ['esi-wallet.read_corporation_wallets.v1'],
				hasRequiredScopes: false,
				hasCorporationWalletScope: false,
				hasCharacterWalletScope: false,
				hasCorporationMembershipScope: true,
				grantedScopeCount: 1,
			}),
		})

		const service = new TaxSettingsService(mockDb, {} as DurableObjectNamespace)

		await expect(
			service.upsertCorporationSettings('98000001', {
				included: true,
			})
		).rejects.toThrow('INCLUSION_VALIDATION_FAILED')
	})

	it('returns enriched ESI auth status when listing settings', async () => {
		mockDb.query.taxCorporationSettings.findMany.mockResolvedValue([createSettingsRow()])
		getStubMock.mockReturnValue({
			getCorporationAuthStatus: vi.fn().mockResolvedValue({
				corporationId: '98000001',
				isConfigured: true,
				isVerified: true,
				lastVerified: new Date('2026-01-01T00:00:00.000Z'),
				directorCount: 1,
				healthyDirectorCount: 1,
				requiredScopes: ['esi-wallet.read_corporation_wallets.v1'],
				missingRequiredScopes: [],
				hasRequiredScopes: true,
				hasCorporationWalletScope: true,
				hasCharacterWalletScope: true,
				hasCorporationMembershipScope: true,
				grantedScopeCount: 3,
			}),
		})

		const service = new TaxSettingsService(mockDb, {} as DurableObjectNamespace)
		const rows = await service.listCorporationSettings()

		expect(rows).toHaveLength(1)
		expect(rows[0]?.esiAuthStatus?.hasCorporationWalletScope).toBe(true)
		expect(rows[0]?.esiAuthStatus?.missingRequiredScopes).toEqual([])
	})
})
