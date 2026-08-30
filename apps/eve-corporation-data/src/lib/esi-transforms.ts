import type {
	EsiCorporationAsset,
	EsiCorporationContract,
	EsiCorporationIndustryJob,
	EsiCorporationKillmail,
	EsiCorporationMemberTracking,
	EsiCorporationOrder,
	EsiCorporationStructure,
	EsiCorporationWalletTransaction,
} from '@repo/eve-corporation-data'

export function transformPublicInfo(data: any) {
	return {
		name: data.name,
		ticker: data.ticker,
		ceoId: String(data.ceo_id),
		creatorId: String(data.creator_id),
		dateFounded: data.date_founded ? new Date(data.date_founded) : null,
		description: data.description || null,
		homeStationId: data.home_station_id ? String(data.home_station_id) : null,
		memberCount: data.member_count,
		shares: data.shares ? data.shares.toString() : null,
		taxRate: data.tax_rate.toString(),
		url: data.url || null,
		allianceId: data.alliance_id ? String(data.alliance_id) : null,
		factionId: data.faction_id ? String(data.faction_id) : null,
		warEligible: data.war_eligible,
	}
}

export function transformMembers(data: number[]): string[] {
	return data.map(String)
}

export function transformMemberTracking(data: any[]): EsiCorporationMemberTracking[] {
	return data.map((member) => ({
		character_id: String(member.character_id),
		base_id: member.base_id ? String(member.base_id) : undefined,
		location_id: member.location_id ? String(member.location_id) : undefined,
		logoff_date: member.logoff_date,
		logon_date: member.logon_date,
		ship_type_id: member.ship_type_id ? String(member.ship_type_id) : undefined,
		start_date: member.start_date,
	}))
}

export function transformWallets(wallets: Array<{ division: number; balance: number }>) {
	return wallets.map((wallet) => ({
		division: wallet.division,
		balance: wallet.balance.toString(),
	}))
}

export function transformWalletJournal(entries: any[]) {
	return entries.map((entry) => ({
		id: String(entry.id),
		amount: entry.amount !== undefined ? String(entry.amount) : undefined,
		balance: entry.balance !== undefined ? String(entry.balance) : undefined,
		context_id: entry.context_id ? String(entry.context_id) : undefined,
		context_id_type: entry.context_id_type,
		date: entry.date,
		description: entry.description,
		first_party_id: entry.first_party_id ? String(entry.first_party_id) : undefined,
		reason: entry.reason,
		ref_type: entry.ref_type,
		second_party_id: entry.second_party_id ? String(entry.second_party_id) : undefined,
		tax: entry.tax !== undefined ? String(entry.tax) : undefined,
		tax_receiver_id: entry.tax_receiver_id ? String(entry.tax_receiver_id) : undefined,
	}))
}

export function transformWalletTransactions(
	transactions: any[]
): EsiCorporationWalletTransaction[] {
	return transactions.map((tx) => ({
		transaction_id: String(tx.transaction_id),
		client_id: String(tx.client_id),
		date: tx.date,
		is_buy: tx.is_buy,
		is_personal: tx.is_personal,
		journal_ref_id: String(tx.journal_ref_id),
		location_id: String(tx.location_id),
		quantity: tx.quantity,
		type_id: String(tx.type_id),
		unit_price: String(tx.unit_price),
	}))
}

export function transformAssets(assets: any[]): EsiCorporationAsset[] {
	return assets.map((asset) => ({
		item_id: String(asset.item_id),
		is_singleton: asset.is_singleton,
		location_flag: asset.location_flag,
		location_id: String(asset.location_id),
		location_type: asset.location_type,
		quantity: asset.quantity,
		type_id: String(asset.type_id),
		is_blueprint_copy: asset.is_blueprint_copy,
	}))
}

export function transformStructures(
	structures: any[],
	corporationId: string
): EsiCorporationStructure[] {
	return structures.map((structure) => ({
		structure_id: String(structure.structure_id),
		corporation_id: String(corporationId),
		type_id: String(structure.type_id),
		system_id: String(structure.system_id),
		profile_id: String(structure.profile_id),
		fuel_expires: structure.fuel_expires,
		next_reinforce_apply: structure.next_reinforce_apply,
		next_reinforce_hour: structure.next_reinforce_hour,
		reinforce_hour: structure.reinforce_hour,
		state: structure.state,
		state_timer_end: structure.state_timer_end,
		state_timer_start: structure.state_timer_start,
		unanchors_at: structure.unanchors_at,
		name: structure.name ?? null,
		fuel_amount: structure.fuel_amount ?? null,
		services: structure.services?.map((service: { name: string; state: string }) => ({
			...service,
		})),
		moon_id: structure.moon_id !== undefined ? String(structure.moon_id) : undefined,
	}))
}

export function transformOrders(orders: any[]): EsiCorporationOrder[] {
	return orders.map((order) => ({
		order_id: String(order.order_id),
		duration: order.duration,
		escrow: order.escrow,
		is_buy_order: order.is_buy_order,
		issued: order.issued,
		issued_by: String(order.issued_by),
		location_id: String(order.location_id),
		min_volume: order.min_volume,
		price: order.price,
		range: order.range,
		region_id: String(order.region_id),
		type_id: String(order.type_id),
		volume_remain: order.volume_remain,
		volume_total: order.volume_total,
		wallet_division: order.wallet_division,
	}))
}

export function transformContracts(contracts: any[]): EsiCorporationContract[] {
	return contracts.map((contract) => ({
		contract_id: String(contract.contract_id),
		acceptor_id: contract.acceptor_id ? String(contract.acceptor_id) : undefined,
		assignee_id: String(contract.assignee_id),
		availability: contract.availability,
		buyout: contract.buyout,
		collateral: contract.collateral,
		date_accepted: contract.date_accepted,
		date_completed: contract.date_completed,
		date_expired: contract.date_expired,
		date_issued: contract.date_issued,
		days_to_complete: contract.days_to_complete,
		end_location_id: contract.end_location_id ? String(contract.end_location_id) : undefined,
		for_corporation: contract.for_corporation,
		issuer_corporation_id: String(contract.issuer_corporation_id),
		issuer_id: String(contract.issuer_id),
		price: contract.price,
		reward: contract.reward,
		start_location_id: contract.start_location_id ? String(contract.start_location_id) : undefined,
		status: contract.status,
		title: contract.title,
		type: contract.type,
		volume: contract.volume,
	}))
}

export function transformIndustryJobs(jobs: any[]): EsiCorporationIndustryJob[] {
	return jobs.map((job) => ({
		job_id: String(job.job_id),
		installer_id: String(job.installer_id),
		facility_id: String(job.facility_id),
		location_id: String(job.location_id),
		activity_id: String(job.activity_id),
		blueprint_id: String(job.blueprint_id),
		blueprint_type_id: String(job.blueprint_type_id),
		blueprint_location_id: String(job.blueprint_location_id),
		output_location_id: String(job.output_location_id),
		runs: job.runs,
		cost: job.cost,
		licensed_runs: job.licensed_runs,
		probability: job.probability,
		product_type_id: job.product_type_id ? String(job.product_type_id) : undefined,
		status: job.status,
		duration: job.duration,
		start_date: job.start_date,
		end_date: job.end_date,
		pause_date: job.pause_date,
		completed_date: job.completed_date,
		completed_character_id: job.completed_character_id
			? String(job.completed_character_id)
			: undefined,
		successful_runs: job.successful_runs,
	}))
}

export function transformKillmails(killmails: any[]): EsiCorporationKillmail[] {
	return killmails.map((km) => ({
		killmail_id: String(km.killmail_id),
		killmail_hash: km.killmail_hash,
	}))
}
