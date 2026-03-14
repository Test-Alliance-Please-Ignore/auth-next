import { desc, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { taxCorporationSettings } from '../db/schema'

import type {
	ListTaxCorporationSettingsFilters,
	TaxCorporationEsiAuthStatus,
	TaxCorporationSettings,
	UpsertTaxCorporationSettingsInput,
} from '@repo/corporation-tax'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { CorporationTaxDb } from '../db'

export class TaxSettingsService {
	constructor(
		private db: CorporationTaxDb,
		private eveCorporationDataNamespace: DurableObjectNamespace
	) {}

	async getCorporationSettings(corporationId: string): Promise<TaxCorporationSettings | null> {
		const row = await this.db.query.taxCorporationSettings.findFirst({
			where: eq(taxCorporationSettings.corporationId, corporationId),
		})

		if (!row) {
			return null
		}

		const esiAuthStatus = await this.safeGetEsiAuthStatus(corporationId)
		return this.toSettings(row, esiAuthStatus)
	}

	async upsertCorporationSettings(
		corporationId: string,
		input: UpsertTaxCorporationSettingsInput
	): Promise<{
		before: TaxCorporationSettings | null
		after: TaxCorporationSettings
	}> {
		const existing = await this.getCorporationSettings(corporationId)
		const inclusionAuthStatus = await this.validateInclusionEligibility(
			corporationId,
			input,
			existing
		)
		const enrichedAuthStatus =
			inclusionAuthStatus ?? (await this.safeGetEsiAuthStatus(corporationId))

		if (existing) {
			const [updated] = await this.db
				.update(taxCorporationSettings)
				.set({
					included: input.included === undefined ? existing.included : input.included,
					exclusionReason:
						input.exclusionReason === undefined ? existing.exclusionReason : input.exclusionReason,
					defaultRateBps:
						input.defaultRateBps === undefined ? existing.defaultRateBps : input.defaultRateBps,
					essRateBps: input.essRateBps === undefined ? existing.essRateBps : input.essRateBps,
					discrepancyThresholdBps:
						input.discrepancyThresholdBps === undefined
							? existing.discrepancyThresholdBps
							: input.discrepancyThresholdBps,
					memberSummaryEnabled:
						input.memberSummaryEnabled === undefined
							? existing.memberSummaryEnabled
							: input.memberSummaryEnabled,
					billingEnabled:
						input.billingEnabled === undefined ? existing.billingEnabled : input.billingEnabled,
					billingIssuerUserId:
						input.billingIssuerUserId === undefined
							? existing.billingIssuerUserId
							: input.billingIssuerUserId,
					billingPayeeId:
						input.billingPayeeId === undefined ? existing.billingPayeeId : input.billingPayeeId,
					billingPayeeType:
						input.billingPayeeType === undefined
							? existing.billingPayeeType
							: input.billingPayeeType,
					billingDueDays:
						input.billingDueDays === undefined ? existing.billingDueDays : input.billingDueDays,
					updatedAt: new Date(),
				})
				.where(eq(taxCorporationSettings.corporationId, corporationId))
				.returning()

			if (!updated) {
				throw new Error(`Failed to update corporation settings for ${corporationId}`)
			}

			return {
				before: existing,
				after: this.toSettings(updated, enrichedAuthStatus),
			}
		}

		const [created] = await this.db
			.insert(taxCorporationSettings)
			.values({
				corporationId,
				included: input.included ?? false,
				exclusionReason: input.exclusionReason ?? null,
				defaultRateBps: input.defaultRateBps ?? 0,
				essRateBps: input.essRateBps ?? 0,
				discrepancyThresholdBps: input.discrepancyThresholdBps ?? 500,
				memberSummaryEnabled: input.memberSummaryEnabled ?? false,
				billingEnabled: input.billingEnabled ?? false,
				billingIssuerUserId: input.billingIssuerUserId ?? null,
				billingPayeeId: input.billingPayeeId ?? null,
				billingPayeeType: input.billingPayeeType ?? null,
				billingDueDays: input.billingDueDays ?? 14,
			})
			.returning()

		if (!created) {
			throw new Error(`Failed to create corporation settings for ${corporationId}`)
		}

		return {
			before: null,
			after: this.toSettings(created, enrichedAuthStatus),
		}
	}

	async listCorporationSettings(
		filters?: ListTaxCorporationSettingsFilters
	): Promise<TaxCorporationSettings[]> {
		const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200)
		const offset = Math.max(filters?.offset ?? 0, 0)

		const rows = await this.db.query.taxCorporationSettings.findMany({
			where:
				filters?.included === undefined
					? undefined
					: eq(taxCorporationSettings.included, filters.included),
			orderBy: [desc(taxCorporationSettings.updatedAt)],
			limit,
			offset,
		})

		return Promise.all(
			rows.map(async (row) => {
				const esiAuthStatus = await this.safeGetEsiAuthStatus(row.corporationId)
				return this.toSettings(row, esiAuthStatus)
			})
		)
	}

	async getCorporationEsiAuthStatus(
		corporationId: string
	): Promise<TaxCorporationEsiAuthStatus | null> {
		return this.safeGetEsiAuthStatus(corporationId)
	}

	async getWalletDivisions(corporationId: string): Promise<number[]> {
		try {
			const stub = getStub<EveCorporationData>(this.eveCorporationDataNamespace, corporationId)
			return await stub.getWalletDivisions(corporationId)
		} catch (_error) {
			return []
		}
	}

	private toSettings(
		row: typeof taxCorporationSettings.$inferSelect,
		esiAuthStatus: TaxCorporationEsiAuthStatus | null
	): TaxCorporationSettings {
		return {
			corporationId: row.corporationId,
			included: row.included,
			exclusionReason: row.exclusionReason,
			defaultRateBps: row.defaultRateBps,
			essRateBps: row.essRateBps,
			discrepancyThresholdBps: row.discrepancyThresholdBps,
			memberSummaryEnabled: row.memberSummaryEnabled,
			billingEnabled: row.billingEnabled,
			billingIssuerUserId: row.billingIssuerUserId,
			billingPayeeId: row.billingPayeeId,
			billingPayeeType: row.billingPayeeType as 'character' | 'corporation' | null,
			billingDueDays: row.billingDueDays,
			esiAuthStatus,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}

	private async validateInclusionEligibility(
		corporationId: string,
		input: UpsertTaxCorporationSettingsInput,
		existing: TaxCorporationSettings | null
	): Promise<TaxCorporationEsiAuthStatus | null> {
		const nextIncluded = input.included ?? existing?.included ?? false
		if (!nextIncluded) {
			return null
		}

		const authStatus = await this.safeGetEsiAuthStatus(corporationId)
		if (!authStatus || !authStatus.isConfigured) {
			throw new Error(
				'INCLUSION_VALIDATION_FAILED: Corporation is not configured in EVE corporation data.'
			)
		}
		if (authStatus.directorCount < 1 || authStatus.healthyDirectorCount < 1) {
			throw new Error(
				'INCLUSION_VALIDATION_FAILED: Corporation must have at least one healthy director token.'
			)
		}
		if (!authStatus.hasCorporationWalletScope) {
			throw new Error(
				`INCLUSION_VALIDATION_FAILED: Missing required ESI scope ${authStatus.requiredScopes.join(', ')}`
			)
		}

		return authStatus
	}

	private async safeGetEsiAuthStatus(
		corporationId: string
	): Promise<TaxCorporationEsiAuthStatus | null> {
		try {
			const stub = getStub<EveCorporationData>(this.eveCorporationDataNamespace, corporationId)
			const status = await stub.getCorporationAuthStatus(corporationId)
			return {
				isConfigured: status.isConfigured,
				isVerified: status.isVerified,
				lastVerified: status.lastVerified,
				directorCount: status.directorCount,
				healthyDirectorCount: status.healthyDirectorCount,
				requiredScopes: status.requiredScopes,
				missingRequiredScopes: status.missingRequiredScopes,
				hasRequiredScopes: status.hasRequiredScopes,
				hasCorporationWalletScope: status.hasCorporationWalletScope,
				hasCharacterWalletScope: status.hasCharacterWalletScope,
				hasCorporationMembershipScope: status.hasCorporationMembershipScope,
				grantedScopeCount: status.grantedScopeCount,
			}
		} catch (_error) {
			return null
		}
	}
}
