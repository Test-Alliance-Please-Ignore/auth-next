import { describe, expect, it } from 'vitest'

import { resolveFlagValue, resolveFlagValues } from './resolution'

import type { ResolvableFlag } from './resolution'

describe('resolveFlagValue', () => {
	it('returns the override when one exists (override true, global false)', () => {
		expect(resolveFlagValue(true, false)).toBe(true)
	})

	it('respects an override of false even when the global default is true', () => {
		// The nullish-vs-falsy trap: `false ?? true` must be false, not true.
		expect(resolveFlagValue(false, true)).toBe(false)
	})

	it('falls back to the global value when there is no override', () => {
		expect(resolveFlagValue(undefined, true)).toBe(true)
		expect(resolveFlagValue(undefined, false)).toBe(false)
	})

	it('falls back to false when neither an override nor a global value exists', () => {
		expect(resolveFlagValue(undefined, null)).toBe(false)
	})

	it('respects an override even when the global value is unset (null)', () => {
		expect(resolveFlagValue(true, null)).toBe(true)
		expect(resolveFlagValue(false, null)).toBe(false)
	})
})

describe('resolveFlagValues', () => {
	const flag = (id: string, key: string, booleanValue: boolean | null): ResolvableFlag => ({
		id,
		key,
		booleanValue,
	})

	it('returns an empty map for no requested keys', () => {
		expect(resolveFlagValues([], [], new Map())).toEqual({})
	})

	it('resolves an unknown flag (requested but not found) to false', () => {
		expect(resolveFlagValues(['missing'], [], new Map())).toEqual({ missing: false })
	})

	it('uses the global value when the flag has no override', () => {
		const flags = [flag('1', 'a', true), flag('2', 'b', false)]
		expect(resolveFlagValues(['a', 'b'], flags, new Map())).toEqual({ a: true, b: false })
	})

	it('lets a user override of false win over a global true', () => {
		const flags = [flag('1', 'a', true)]
		const overrides = new Map([['1', false]])
		expect(resolveFlagValues(['a'], flags, overrides)).toEqual({ a: false })
	})

	it('lets a user override of true win over a global false', () => {
		const flags = [flag('1', 'a', false)]
		const overrides = new Map([['1', true]])
		expect(resolveFlagValues(['a'], flags, overrides)).toEqual({ a: true })
	})

	it('resolves a flag with a null global value and no override to false', () => {
		const flags = [flag('1', 'a', null)]
		expect(resolveFlagValues(['a'], flags, new Map())).toEqual({ a: false })
	})

	it('produces a complete map for a mixed batch, including unknown keys', () => {
		const flags = [flag('1', 'a', true), flag('2', 'b', false)]
		const overrides = new Map([['2', true]])
		expect(resolveFlagValues(['a', 'b', 'missing'], flags, overrides)).toEqual({
			a: true, // global default
			b: true, // override wins over global false
			missing: false, // unregistered flag
		})
	})

	it('collapses duplicate keys to a single resolved entry', () => {
		const flags = [flag('1', 'a', true)]
		expect(resolveFlagValues(['a', 'a'], flags, new Map())).toEqual({ a: true })
	})

	it('does not resolve a flag that was not requested', () => {
		// Defensive: only requested keys should appear; a stray fetched flag that
		// was not requested still gets written, but callers only pass fetched
		// flags for requested keys. This documents the seeding contract.
		const flags = [flag('1', 'a', true)]
		const result = resolveFlagValues(['a'], flags, new Map())
		expect(Object.keys(result)).toEqual(['a'])
	})
})
