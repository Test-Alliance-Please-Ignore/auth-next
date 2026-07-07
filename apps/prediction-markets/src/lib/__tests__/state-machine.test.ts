import { describe, expect, it } from 'vitest'

import { assertTransition, canTransition, isTerminal } from '../state-machine'

describe('market state machine', () => {
	it('allows the canonical lifecycle transitions', () => {
		expect(canTransition('draft', 'open')).toBe(true)
		expect(canTransition('open', 'closed')).toBe(true)
		expect(canTransition('closed', 'resolving')).toBe(true)
		expect(canTransition('closed', 'resolved')).toBe(true)
		expect(canTransition('resolving', 'resolved')).toBe(true)
	})

	it('allows voiding from any non-terminal state', () => {
		expect(canTransition('draft', 'voided')).toBe(true)
		expect(canTransition('open', 'voided')).toBe(true)
		expect(canTransition('closed', 'voided')).toBe(true)
		expect(canTransition('resolving', 'voided')).toBe(true)
	})

	it('treats resolved and voided as terminal', () => {
		expect(isTerminal('resolved')).toBe(true)
		expect(isTerminal('voided')).toBe(true)
		expect(canTransition('resolved', 'open')).toBe(false)
		expect(canTransition('resolved', 'voided')).toBe(false)
		expect(canTransition('voided', 'resolved')).toBe(false)
	})

	it('rejects skipping straight from open to resolved', () => {
		expect(canTransition('open', 'resolved')).toBe(false)
	})

	it('assertTransition throws on an invalid transition', () => {
		expect(() => assertTransition('open', 'resolved')).toThrow()
		expect(() => assertTransition('closed', 'resolving')).not.toThrow()
	})
})
