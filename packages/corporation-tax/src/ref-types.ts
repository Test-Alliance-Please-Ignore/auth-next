export const TAX_INCOME_REF_TYPES = [
	'agent_mission_reward',
	'agent_mission_time_bonus_reward',
	'bounty_prizes',
	'brokers_fee',
	'contract_collateral_payout',
	'contract_price',
	'contract_price_payment_corp',
	'contract_reward',
	'corporate_reward_payout',
	'daily_goal_payouts',
	'ess_escrow_transfer',
	'freelance_jobs_reward',
	'industry_job_tax',
	'inheritance',
	'insurance',
	'jump_clone_activation_fee',
	'jump_clone_installation_fee',
	'market_transaction',
	'office_rental_fee',
	'planetary_export_tax',
	'planetary_import_tax',
	'player_donation',
	'project_discovery_reward',
	'project_payouts',
	'reprocessing_tax',
	'structure_gate_jump',
	'war_fee_surrender',
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
