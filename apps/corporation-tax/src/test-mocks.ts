import { DurableObject } from 'cloudflare:workers'

export class MockBills extends DurableObject {
	async createBillFromExternalSource(): Promise<null> {
		return null
	}

	async getBillIntegrationView(): Promise<null> {
		return null
	}

	async getBillTimeline(): Promise<unknown[]> {
		return []
	}

	async getBillTimelines(): Promise<Record<string, unknown[]>> {
		return {}
	}

	async listBillsByExternalSource(): Promise<unknown[]> {
		return []
	}

	async issueBill(): Promise<{ id: string; status: 'issued' }> {
		return {
			id: 'mock-bill-id',
			status: 'issued',
		}
	}
}

export class MockEveCorporationData extends DurableObject {
	async getWalletJournalWindow(): Promise<unknown[]> {
		return []
	}

	async getWalletTransactionsWindow(): Promise<unknown[]> {
		return []
	}

	async getMembers(): Promise<Array<{ characterId: string }>> {
		return []
	}

	async getCorporationTaxMetadata(): Promise<{
		corporationId: string
		inGameTaxRateBps: number | null
		ceoId: string | null
		memberCount: number | null
		allianceId: string | null
		updatedAt: Date | null
	}> {
		return {
			corporationId: '0',
			inGameTaxRateBps: null,
			ceoId: null,
			memberCount: null,
			allianceId: null,
			updatedAt: null,
		}
	}

	async getCorporationAuthStatus(): Promise<{
		corporationId: string
		isConfigured: boolean
		isVerified: boolean
		lastVerified: Date | null
		directorCount: number
		healthyDirectorCount: number
		requiredScopes: string[]
		missingRequiredScopes: string[]
		hasRequiredScopes: boolean
		hasCorporationWalletScope: boolean
		hasCharacterWalletScope: boolean
		hasCorporationMembershipScope: boolean
		grantedScopeCount: number
	}> {
		return {
			corporationId: '0',
			isConfigured: false,
			isVerified: false,
			lastVerified: null,
			directorCount: 0,
			healthyDirectorCount: 0,
			requiredScopes: ['esi-wallet.read_corporation_wallets.v1'],
			missingRequiredScopes: ['esi-wallet.read_corporation_wallets.v1'],
			hasRequiredScopes: false,
			hasCorporationWalletScope: false,
			hasCharacterWalletScope: false,
			hasCorporationMembershipScope: false,
			grantedScopeCount: 0,
		}
	}
}

export class MockEveCharacterData extends DurableObject {
	async getWalletJournalWindow(): Promise<unknown[]> {
		return []
	}

	async getMarketTransactionsWindow(): Promise<unknown[]> {
		return []
	}
}

export class MockDiscord extends DurableObject {
	async sendMessage(): Promise<{ success: boolean; messageId: string }> {
		return {
			success: true,
			messageId: 'mock-discord-message-id',
		}
	}
}
