export type RuleFreshnessWindowInput = {
	projectionUpdatedAt: Date | null
	openPeriodStart: Date
	earliestRuleSetMutationAt: Date | null
	membershipMutationAt: Date | null
}

export function computeRuleMutationRecalcStart(
	input: RuleFreshnessWindowInput
): Date | null {
	const projectionUpdatedAt = input.projectionUpdatedAt ?? new Date(0)
	const earliestRelevantMutation = minDate(
		input.earliestRuleSetMutationAt,
		input.membershipMutationAt
	)
	if (!earliestRelevantMutation || earliestRelevantMutation <= projectionUpdatedAt) {
		return null
	}
	return maxDate(input.openPeriodStart, earliestRelevantMutation)
}

function minDate(...dates: Array<Date | null | undefined>): Date | null {
	let earliest: Date | null = null
	for (const value of dates) {
		if (!value) continue
		if (!earliest || value < earliest) {
			earliest = value
		}
	}
	return earliest
}

function maxDate(...dates: Array<Date | null | undefined>): Date {
	let latest: Date | null = null
	for (const value of dates) {
		if (!value) continue
		if (!latest || value > latest) {
			latest = value
		}
	}
	return latest ?? new Date(0)
}
