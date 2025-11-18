import { DurableObject } from 'cloudflare:workers'

import { EsiFetcher } from './esi-fetch'
import {
	transformAssets,
	transformContracts,
	transformIndustryJobs,
	transformKillmails,
	transformMembers,
	transformMemberTracking,
	transformOrders,
	transformStructures,
	transformWalletJournal,
	transformWallets,
	transformWalletTransactions,
} from './lib/esi-transforms'

import type {
	CorporationAsset,
	CorporationContract,
	CorporationIndustryJob,
	CorporationKillmail,
	CorporationMembers,
	CorporationMemberTracking,
	CorporationOrder,
	CorporationStructure,
	CorporationWallet,
	CorporationWalletJournalEntry,
	CorporationWalletTransaction,
	Esi,
	EsiCorporationAsset,
	EsiCorporationContract,
	EsiCorporationIndustryJob,
	EsiCorporationKillmail,
	EsiCorporationMembers,
	EsiCorporationMemberTracking,
	EsiCorporationOrder,
	EsiCorporationStructure,
	EsiCorporationWallet,
	EsiCorporationWalletJournalEntry,
	EsiCorporationWalletTransaction,
} from '@repo/esi'
import type { Env } from './context'

export class EsiDO extends DurableObject<Env> implements Esi {
	private esiFetcher: EsiFetcher

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.esiFetcher = new EsiFetcher(state, env)
	}

	/**
	 * Fetch corporation members from ESI
	 */
	async fetchMembers(corporationId: string): Promise<CorporationMembers> {
		this.esiFetcher.authenticateWithCorporation(corporationId)
		const result = await this.esiFetcher.fetchEsi<EsiCorporationMembers>(
			`/corporations/${corporationId}/members`
		)
		return transformMembers(result.data)
	}

	async fetchMemberTracking(corporationId: string): Promise<CorporationMemberTracking[]> {
		this.esiFetcher.authenticateWithCorporation(corporationId)
		const result = await this.esiFetcher.fetchEsi<EsiCorporationMemberTracking>(
			`/corporations/${corporationId}/membertracking`
		)
		return transformMemberTracking(result.data)
	}

	async fetchWallets(corporationId: string): Promise<CorporationWallet[]> {
		this.esiFetcher.authenticateWithCorporation(corporationId)
		const result = await this.esiFetcher.fetchEsi<EsiCorporationWallet>(
			`/corporations/${corporationId}/wallets`
		)
		return transformWallets(result.data)
	}

	async fetchWalletJournal(
		corporationId: string,
		division: number
	): Promise<CorporationWalletJournalEntry[]> {
		this.esiFetcher.authenticateWithCorporation(corporationId)
		const result = await this.esiFetcher.fetchEsi<EsiCorporationWalletJournalEntry>(
			`/corporations/${corporationId}/wallets/${division}/journal`
		)
		return transformWalletJournal(result.data)
	}

	async fetchWalletTransactions(
		corporationId: string,
		division: number
	): Promise<CorporationWalletTransaction[]> {
		this.esiFetcher.authenticateWithCorporation(corporationId)
		const result = await this.esiFetcher.fetchEsi<EsiCorporationWalletTransaction>(
			`/corporations/${corporationId}/wallets/${division}/transactions`
		)
		return transformWalletTransactions(result.data)
	}

	async fetchAssets(corporationId: string): Promise<CorporationAsset[]> {
		this.esiFetcher.authenticateWithCorporation(corporationId)
		const result = await this.esiFetcher.fetchEsi<EsiCorporationAsset>(
			`/corporations/${corporationId}/assets`
		)
		return transformAssets(result.data)
	}

	async fetchStructures(corporationId: string): Promise<CorporationStructure[]> {
		this.esiFetcher.authenticateWithCorporation(corporationId)
		const result = await this.esiFetcher.fetchEsi<EsiCorporationStructure>(
			`/corporations/${corporationId}/structures`
		)
		return transformStructures(result.data)
	}

	async fetchOrders(corporationId: string): Promise<CorporationOrder[]> {
		this.esiFetcher.authenticateWithCorporation(corporationId)
		const result = await this.esiFetcher.fetchEsi<EsiCorporationOrder>(
			`/corporations/${corporationId}/orders`
		)
		return transformOrders(result.data)
	}

	async fetchContracts(corporationId: string): Promise<CorporationContract[]> {
		this.esiFetcher.authenticateWithCorporation(corporationId)
		const result = await this.esiFetcher.fetchEsi<EsiCorporationContract>(
			`/corporations/${corporationId}/contracts`
		)
		return transformContracts(result.data)
	}

	async fetchIndustryJobs(corporationId: string): Promise<CorporationIndustryJob[]> {
		this.esiFetcher.authenticateWithCorporation(corporationId)
		const result = await this.esiFetcher.fetchEsi<EsiCorporationIndustryJob>(
			`/corporations/${corporationId}/industry/jobs`
		)
		return transformIndustryJobs(result.data)
	}

	async fetchKillmails(corporationId: string): Promise<CorporationKillmail[]> {
		this.esiFetcher.authenticateWithCorporation(corporationId)
		const result = await this.esiFetcher.fetchEsi<EsiCorporationKillmail>(
			`/corporations/${corporationId}/killmails/recent`
		)
		return transformKillmails(result.data)
	}
}
