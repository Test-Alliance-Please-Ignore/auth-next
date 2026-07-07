import { describe, expect, it } from 'vitest'

import {
	customIdAction,
	decodeBetTarget,
	encodeBetButtonId,
	encodeBetModalId,
} from '../lib/market-custom-id'

const MKT = '11111111-1111-1111-1111-111111111111'
const OUT = '22222222-2222-2222-2222-222222222222'

describe('market custom_id', () => {
	it('encodes bet button + modal ids under the 100-char limit', () => {
		const btn = encodeBetButtonId(MKT, OUT)
		const modal = encodeBetModalId(MKT, OUT)
		expect(btn).toBe(`bet:${MKT}:${OUT}`)
		expect(modal).toBe(`betmodal:${MKT}:${OUT}`)
		expect(btn.length).toBeLessThanOrEqual(100)
		expect(modal.length).toBeLessThanOrEqual(100)
	})

	it('round-trips bet + betmodal ids to their targets', () => {
		expect(decodeBetTarget(encodeBetButtonId(MKT, OUT))).toEqual({ marketId: MKT, outcomeId: OUT })
		expect(decodeBetTarget(encodeBetModalId(MKT, OUT))).toEqual({ marketId: MKT, outcomeId: OUT })
	})

	it('returns null for malformed / foreign custom_ids', () => {
		expect(decodeBetTarget('bet:only-two')).toBeNull() // 2 segments
		expect(decodeBetTarget(`mkt:close:${MKT}`)).toBeNull() // wrong action
		expect(decodeBetTarget(`bet::${OUT}`)).toBeNull() // empty marketId
		expect(decodeBetTarget('')).toBeNull()
	})

	it('extracts the action prefix', () => {
		expect(customIdAction('betmodal:a:b')).toBe('betmodal')
		expect(customIdAction('nocolon')).toBe('nocolon')
	})
})
