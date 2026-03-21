export const TAX_INCOME_REF_TYPES = [
	'agent_mission_reward_corporation_tax',
	'agent_mission_time_bonus_reward_corporation_tax',
	'bounty_prize_corporation_tax',
	'contract_price',
	'ess_escrow_transfer',
	'external_trade_delivery',
	'freelance_jobs_reward_corporation_tax',
	'industry_job_tax',
	'market_transaction',
	'mission_reward',
	'office_rental_fee',
	'planetary_export_tax',
	'planetary_import_tax',
	'player_donation',
	'project_discovery_tax',
	'project_discovery_reward',
	'reprocessing_tax',
	'structure_gate_jump',
] as const

export type TaxIncomeRefType = (typeof TAX_INCOME_REF_TYPES)[number]

const TAX_INCOME_REF_TYPE_SET = new Set<string>(TAX_INCOME_REF_TYPES)

export function isTaxIncomeRefType(refType: string): refType is TaxIncomeRefType {
	return TAX_INCOME_REF_TYPE_SET.has(refType)
}

export function filterTaxIncomeRefTypes(refTypes?: string[]): string[] | undefined {
	if (!refTypes || refTypes.length === 0) {
		return undefined
	}
	const filtered = refTypes.filter((refType) => isTaxIncomeRefType(refType))
	return filtered.length > 0 ? filtered : undefined
}
