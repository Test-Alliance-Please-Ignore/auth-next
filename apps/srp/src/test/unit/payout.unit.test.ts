import { describe, expect, it } from 'vitest'

import { computeSrpPayout } from '../../lib/payout'
import type { ComputeSrpPayoutInput } from '../../lib/payout'

// ─── Policy fixtures (from plan) ──────────────────────────────────────────────

const POLICY_NON_FLEET_80 = { rate: '0.80', applyInsuranceDelta: true }
const POLICY_FLEET_100 = { rate: '1.00', applyInsuranceDelta: true }
const POLICY_LOGI_100_NO_INS = { rate: '1.00', applyInsuranceDelta: false }
const POLICY_MILITARY_DPS_90 = { rate: '0.90', applyInsuranceDelta: true }
const POLICY_MILITARY_LOGI_110 = { rate: '1.10', applyInsuranceDelta: true }

// ─── Cap fixtures (from plan) ─────────────────────────────────────────────────

const CAP_BLANKET_300M = { maxPayoutMillions: 300 }
const CAP_FC_1500M = { maxPayoutMillions: 1500 }
const CAP_WAR_500M = { maxPayoutMillions: 500 }
const CAP_ADM_200M = { maxPayoutMillions: 200 }

// ─── Ad-hoc modifier fixtures (from plan examples) ────────────────────────────

const MOD_MISSING_RIG: ComputeSrpPayoutInput['modifiers'][0] = {
	id: '1',
	modifierType: 'deduction',
	mode: 'percentage',
	amount: 50,
	reason: 'Missing rig',
	computedAmountISK: '0',
}
const MOD_NERFED_TANK: ComputeSrpPayoutInput['modifiers'][0] = {
	id: '2',
	modifierType: 'deduction',
	mode: 'percentage',
	amount: 25,
	reason: 'Nerfed tank',
	computedAmountISK: '0',
}
const MOD_T2_TO_T1_DOWNGRADE: ComputeSrpPayoutInput['modifiers'][0] = {
	id: '3',
	modifierType: 'deduction',
	mode: 'value',
	amount: 20,
	reason: 'T2→T1 module downgrade price difference',
	computedAmountISK: '0',
}
const MOD_DEADSPACE_BONUS: ComputeSrpPayoutInput['modifiers'][0] = {
	id: '4',
	modifierType: 'bonus',
	mode: 'value',
	amount: 40,
	reason: 'Deadspace repper replacement',
	computedAmountISK: '0',
}
const MOD_TWO_MISSING_RIGS: ComputeSrpPayoutInput['modifiers'][0] = {
	id: '5',
	modifierType: 'deduction',
	mode: 'percentage',
	amount: 100,
	reason: 'Two missing rigs',
	computedAmountISK: '0',
}

// ─── Insurance fixtures ───────────────────────────────────────────────────────

// Cost 10M, payout 60M → net profit = 50M
const INS_NORMAL = { insurancePremium: '10000000', insurancePayout: '60000000' }
// Cost 50M, payout 10M → net = 0 (payout < cost)
const INS_UNDERWATER = { insurancePremium: '50000000', insurancePayout: '10000000' }
// Cost 2M, payout 50M → net = 48M (plan example)
const INS_PLAN_EXAMPLE = { insurancePremium: '2000000', insurancePayout: '50000000' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const base = (
	overrides: Partial<ComputeSrpPayoutInput> = {}
): ComputeSrpPayoutInput => ({
	equipmentValue: '500000000',
	insurancePremium: null,
	insurancePayout: null,
	modifierPolicy: null,
	capPolicy: null,
	modifiers: [],
	overrideMillions: null,
	...overrides,
})

// ─── Baseline ─────────────────────────────────────────────────────────────────

describe('baseline — no policy, no modifiers, no insurance', () => {
	it('returns equipment value rounded to nearest million', () => {
		expect(computeSrpPayout(base())).toBe('500000000')
	})

	it('rounds to nearest million for non-million values', () => {
		expect(computeSrpPayout(base({ equipmentValue: '500600000' }))).toBe('501000000')
	})
})

// ─── Payout modifier policies ─────────────────────────────────────────────────

describe('payout modifier policies', () => {
	it('Non-fleet blanket 80% — no insurance', () => {
		// 500M × 0.80 = 400M
		expect(computeSrpPayout(base({ modifierPolicy: POLICY_NON_FLEET_80 }))).toBe('400000000')
	})

	it('Non-fleet blanket 80% — with insurance (net 50M)', () => {
		// (500M - 50M) × 0.80 = 360M
		expect(
			computeSrpPayout(base({ modifierPolicy: POLICY_NON_FLEET_80, ...INS_NORMAL }))
		).toBe('360000000')
	})

	it('Fleet blanket 100% — with insurance (net 50M)', () => {
		// (500M - 50M) × 1.00 = 450M
		expect(
			computeSrpPayout(base({ modifierPolicy: POLICY_FLEET_100, ...INS_NORMAL }))
		).toBe('450000000')
	})

	it('Logistics 100% no insurance deduction — insurance is ignored', () => {
		// applyInsuranceDelta=false: 500M × 1.00 = 500M regardless of insurance
		expect(
			computeSrpPayout(base({ modifierPolicy: POLICY_LOGI_100_NO_INS, ...INS_NORMAL }))
		).toBe('500000000')
	})

	it('Military DPS 90% — no insurance', () => {
		// 500M × 0.90 = 450M
		expect(computeSrpPayout(base({ modifierPolicy: POLICY_MILITARY_DPS_90 }))).toBe('450000000')
	})

	it('Military Logi/Links 110% — no insurance', () => {
		// 500M × 1.10 = 550M
		expect(computeSrpPayout(base({ modifierPolicy: POLICY_MILITARY_LOGI_110 }))).toBe('550000000')
	})

	it('insurance where payout < premium produces zero net delta', () => {
		// underwater insurance: net = 0, no deduction applied
		// 500M × 0.80 = 400M
		expect(
			computeSrpPayout(base({ modifierPolicy: POLICY_NON_FLEET_80, ...INS_UNDERWATER }))
		).toBe('400000000')
	})
})

// ─── Cap policies ─────────────────────────────────────────────────────────────

describe('cap policies', () => {
	it('ADM fleet cap 200M — clamps 500M down to 200M', () => {
		expect(computeSrpPayout(base({ capPolicy: CAP_ADM_200M }))).toBe('200000000')
	})

	it('War campaign cap 500M — exactly at cap, not clamped', () => {
		expect(computeSrpPayout(base({ capPolicy: CAP_WAR_500M }))).toBe('500000000')
	})

	it('War campaign cap 500M — Logi 110% (550M) gets clamped to 500M', () => {
		expect(
			computeSrpPayout(base({ modifierPolicy: POLICY_MILITARY_LOGI_110, capPolicy: CAP_WAR_500M }))
		).toBe('500000000')
	})

	it('FC reimbursement cap 1.5B — 500M well under cap, not clamped', () => {
		expect(computeSrpPayout(base({ capPolicy: CAP_FC_1500M }))).toBe('500000000')
	})

	it('Blanket cap 300M — applied after insurance delta and rate', () => {
		// 80% policy + 50M net insurance: 450M × 0.80 = 360M → under 300M cap → clamped to 300M
		expect(
			computeSrpPayout(
				base({ modifierPolicy: POLICY_NON_FLEET_80, capPolicy: CAP_BLANKET_300M, ...INS_NORMAL })
			)
		).toBe('300000000')
	})
})

// ─── Ad-hoc modifiers ─────────────────────────────────────────────────────────

describe('ad-hoc modifiers', () => {
	it('percentage deduction 50% (Missing rig)', () => {
		// 500M × 0.50 = 250M
		expect(computeSrpPayout(base({ modifiers: [MOD_MISSING_RIG] }))).toBe('250000000')
	})

	it('percentage deduction 25% (Nerfed tank)', () => {
		// 500M × 0.75 = 375M
		expect(computeSrpPayout(base({ modifiers: [MOD_NERFED_TANK] }))).toBe('375000000')
	})

	it('value deduction 20M (T2→T1 downgrade)', () => {
		// 500M - 20M = 480M
		expect(computeSrpPayout(base({ modifiers: [MOD_T2_TO_T1_DOWNGRADE] }))).toBe('480000000')
	})

	it('value bonus 40M (Deadspace repper)', () => {
		// 500M + 40M = 540M
		expect(computeSrpPayout(base({ modifiers: [MOD_DEADSPACE_BONUS] }))).toBe('540000000')
	})

	it('100% percentage deduction (Two missing rigs) → zero payout', () => {
		expect(computeSrpPayout(base({ modifiers: [MOD_TWO_MISSING_RIGS] }))).toBe('0')
	})

	it('two 50% deductions compound (not additive) — 500M → 250M → 125M', () => {
		expect(
			computeSrpPayout(base({ modifiers: [MOD_MISSING_RIG, MOD_MISSING_RIG] }))
		).toBe('125000000')
	})

	it('value deduction larger than current value clamps to 0', () => {
		const bigDeduction = {
			...MOD_T2_TO_T1_DOWNGRADE,
			amount: 600, // 600M > 500M equipment value
		}
		expect(computeSrpPayout(base({ modifiers: [bigDeduction] }))).toBe('0')
	})

	it('deduction then bonus — applied in order', () => {
		// 500M × 0.75 (nerfed tank) = 375M; then +40M deadspace = 415M
		expect(
			computeSrpPayout(base({ modifiers: [MOD_NERFED_TANK, MOD_DEADSPACE_BONUS] }))
		).toBe('415000000')
	})
})

// ─── Policies + modifiers combined ────────────────────────────────────────────

describe('policy + modifiers combined', () => {
	it('80% rate then 50% deduction (Missing rig)', () => {
		// 500M × 0.80 = 400M; then × 0.50 = 200M
		expect(
			computeSrpPayout(
				base({ modifierPolicy: POLICY_NON_FLEET_80, modifiers: [MOD_MISSING_RIG] })
			)
		).toBe('200000000')
	})

	it('80% rate then 25% deduction (Nerfed tank)', () => {
		// 500M × 0.80 = 400M; then × 0.75 = 300M
		expect(
			computeSrpPayout(
				base({ modifierPolicy: POLICY_NON_FLEET_80, modifiers: [MOD_NERFED_TANK] })
			)
		).toBe('300000000')
	})

	it('100% rate + 100% deduction → zero payout', () => {
		expect(
			computeSrpPayout(
				base({ modifierPolicy: POLICY_FLEET_100, modifiers: [MOD_TWO_MISSING_RIGS] })
			)
		).toBe('0')
	})

	it('policy + modifier + cap all applied in correct order', () => {
		// Equipment 600M, DPS 90% → 540M, -50% missing rig → 270M, blanket 300M cap → 270M (under cap)
		expect(
			computeSrpPayout(
				base({
					equipmentValue: '600000000',
					modifierPolicy: POLICY_MILITARY_DPS_90,
					modifiers: [MOD_MISSING_RIG],
					capPolicy: CAP_BLANKET_300M,
				})
			)
		).toBe('270000000')
	})

	it('plan example — 80% + 10% bling penalty + 5M FC bonus + 200M cap', () => {
		// Equipment: 100M
		// Insurance net: 50M - 2M = 48M → base = 52M
		// × 0.80 = 41.6M
		// −10% bling: 41.6M × 0.90 = 37.44M
		// +5M FC: 37.44M + 5M = 42.44M
		// cap 200M: no effect
		// round down: 42M
		const blingPenalty = {
			id: '10',
			modifierType: 'deduction' as const,
			mode: 'percentage' as const,
			amount: 10,
			reason: 'Bling Penalty',
			computedAmountISK: '0',
		}
		const fcBonus = {
			id: '11',
			modifierType: 'bonus' as const,
			mode: 'value' as const,
			amount: 5,
			reason: 'FC Bonus',
			computedAmountISK: '0',
		}
		expect(
			computeSrpPayout({
				equipmentValue: '100000000',
				...INS_PLAN_EXAMPLE,
				modifierPolicy: POLICY_NON_FLEET_80,
				capPolicy: CAP_ADM_200M,
				modifiers: [blingPenalty, fcBonus],
				overrideMillions: null,
			})
		).toBe('42000000')
	})
})

// ─── Override ─────────────────────────────────────────────────────────────────

describe('reviewer override', () => {
	it('override replaces all policy, modifier, and insurance computation', () => {
		expect(
			computeSrpPayout(
				base({
					modifierPolicy: POLICY_NON_FLEET_80,
					modifiers: [MOD_MISSING_RIG],
					capPolicy: CAP_ADM_200M,
					...INS_NORMAL,
					overrideMillions: 100,
				})
			)
		).toBe('100000000')
	})

	it('override of 0 produces zero payout', () => {
		expect(computeSrpPayout(base({ overrideMillions: 0 }))).toBe('0')
	})

	it('override is rounded to nearest million', () => {
		// overrideMillions=42 → 42,000,000 (already a million multiple, passes through)
		expect(computeSrpPayout(base({ overrideMillions: 42 }))).toBe('42000000')
	})
})
