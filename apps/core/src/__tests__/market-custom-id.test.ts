import { describe, expect, it } from 'vitest'

import {
	customIdAction,
	decodeBetTarget,
	decodeMarketAction,
	decodeSingleMarketId,
	encodeBetButtonId,
	encodeBetModalId,
	encodeMarketActionId,
	encodeResolveModalId,
	encodeVoidModalId,
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

describe('market resolver custom_id', () => {
	it('encodes/decodes mkt:<action>:<marketId> buttons', () => {
		expect(encodeMarketActionId('close', MKT)).toBe(`mkt:close:${MKT}`)
		expect(decodeMarketAction(`mkt:resolve:${MKT}`)).toEqual({ action: 'resolve', marketId: MKT })
		expect(decodeMarketAction(`mkt:approve:${MKT}`)).toEqual({ action: 'approve', marketId: MKT })
		expect(decodeMarketAction(`mkt:void:${MKT}`)).toEqual({ action: 'void', marketId: MKT })
	})

	it('rejects unknown actions and non-mkt ids', () => {
		expect(decodeMarketAction(`mkt:bogus:${MKT}`)).toBeNull()
		expect(decodeMarketAction(`bet:${MKT}:${OUT}`)).toBeNull()
		expect(decodeMarketAction('mkt:close:')).toBeNull()
	})

	it('decodes single-market modal ids by prefix', () => {
		expect(decodeSingleMarketId(`resolvemodal:${MKT}`, 'resolvemodal')).toBe(MKT)
		expect(decodeSingleMarketId(`voidmodal:${MKT}`, 'voidmodal')).toBe(MKT)
		expect(decodeSingleMarketId(`resolvemodal:${MKT}`, 'voidmodal')).toBeNull() // prefix mismatch
		expect(decodeSingleMarketId('resolvemodal:', 'resolvemodal')).toBeNull() // empty id
	})

	// Pins the encoders the interactions worker mirrors inline (it can't import core).
	it('round-trips the resolver modal encoders', () => {
		expect(decodeSingleMarketId(encodeResolveModalId(MKT), 'resolvemodal')).toBe(MKT)
		expect(decodeSingleMarketId(encodeVoidModalId(MKT), 'voidmodal')).toBe(MKT)
		expect(encodeResolveModalId(MKT)).toBe(`resolvemodal:${MKT}`)
		expect(encodeVoidModalId(MKT)).toBe(`voidmodal:${MKT}`)
	})
})
