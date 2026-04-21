import { roundToMillion } from '@repo/srp'

import type { AppliedModifier, CapConfig, PayoutModifierConfig } from '@repo/srp'

export interface ComputeSrpPayoutInput {
	equipmentValue: string
	insurancePremium: string | null
	insurancePayout: string | null
	modifierPolicy: PayoutModifierConfig | null
	capPolicy: CapConfig | null
	modifiers: AppliedModifier[]
	overrideMillions: number | null
}

/**
 * Compute the final SRP approved payout amount.
 * Pure function — no I/O. Used by submitReview.
 *
 * Order of operations:
 * 1. Start from equipmentValue
 * 2. Insurance delta (only if policy.applyInsuranceDelta): base -= max(0, payout - premium)
 * 3. Coverage rate: base *= parseFloat(policy.rate) — default 1.0 if no policy
 * 4. Ad-hoc modifiers applied in order
 * 5. Clamp to minimum 0
 * 6. Cap: min(result, cap.maxPayoutMillions × 1_000_000)
 * 7. Override: if set, replaces steps 1–6 entirely
 * 8. roundToMillion (nearest million rounding)
 */
export function computeSrpPayout(input: ComputeSrpPayoutInput): string {
	// Step 7: override replaces everything
	if (input.overrideMillions != null) {
		const raw = BigInt(input.overrideMillions) * 1_000_000n
		return roundToMillion(String(raw < 0n ? 0n : raw))
	}

	let base = BigInt(input.equipmentValue)

	// Step 2: insurance delta
	const applyInsurance = input.modifierPolicy?.applyInsuranceDelta ?? true
	if (applyInsurance && input.insurancePremium != null && input.insurancePayout != null) {
		const cost = BigInt(input.insurancePremium)
		const payout = BigInt(input.insurancePayout)
		const net = payout > cost ? payout - cost : 0n
		base = base > net ? base - net : 0n
	}

	// Step 3: coverage rate (stored as string e.g. "0.80")
	const rate = parseFloat(input.modifierPolicy?.rate ?? '1.0')
	let current = BigInt(Math.floor(Number(base) * rate))

	// Step 4: ad-hoc modifiers in order
	for (const mod of input.modifiers) {
		if (mod.mode === 'percentage') {
			const factor =
				mod.modifierType === 'deduction' ? 1 - mod.amount / 100 : 1 + mod.amount / 100
			current = BigInt(Math.floor(Number(current) * factor))
		} else {
			// value: amount × 1M ISK
			const isk = BigInt(mod.amount) * 1_000_000n
			if (mod.modifierType === 'deduction') {
				current = current >= isk ? current - isk : 0n
			} else {
				current = current + isk
			}
		}
	}

	// Step 5: clamp to 0
	if (current < 0n) current = 0n

	// Step 6: cap
	if (input.capPolicy) {
		const cap = BigInt(input.capPolicy.maxPayoutMillions) * 1_000_000n
		if (current > cap) current = cap
	}

	// Step 8: round to nearest million
	return roundToMillion(String(current))
}
