import { describe, expect, it } from 'vitest'

import {
	canResolveDesignated,
	isDesignatedOverride,
	isDesignatedResolver,
	normalizeDesignatedResolvers,
} from '../designated-resolvers'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const C = '33333333-3333-3333-3333-333333333333'

describe('normalizeDesignatedResolvers', () => {
	it('collapses null/undefined/empty to undefined (no designation)', () => {
		expect(normalizeDesignatedResolvers(null)).toBeUndefined()
		expect(normalizeDesignatedResolvers(undefined)).toBeUndefined()
		expect(normalizeDesignatedResolvers([])).toBeUndefined()
	})

	it('lowercase-canonicalizes and de-duplicates (case-variant dupes collapse)', () => {
		expect(normalizeDesignatedResolvers([A.toUpperCase(), A])).toEqual([A])
		expect(normalizeDesignatedResolvers([A, B, A])).toEqual([A, B])
	})

	it('preserves distinct members in order', () => {
		expect(normalizeDesignatedResolvers([A, B])).toEqual([A, B])
	})
})

describe('canResolveDesignated', () => {
	it('allows any actor when there is no designation (backward-compat keystone)', () => {
		expect(canResolveDesignated(null, A, false)).toBe(true)
		expect(canResolveDesignated(undefined, A, false)).toBe(true)
		expect(canResolveDesignated([], A, false)).toBe(true)
	})

	it('allows a member and rejects a non-member when narrowed', () => {
		expect(canResolveDesignated([A, B], A, false)).toBe(true)
		expect(canResolveDesignated([A, B], C, false)).toBe(false)
	})

	it('matches members case-insensitively', () => {
		expect(canResolveDesignated([A], A.toUpperCase(), false)).toBe(true)
	})

	it('bypass (admin/manager) overrides membership only', () => {
		expect(canResolveDesignated([A, B], C, true)).toBe(true)
	})
})

describe('isDesignatedResolver', () => {
	it('is false when there is no designation', () => {
		expect(isDesignatedResolver(null, A)).toBe(false)
		expect(isDesignatedResolver([], A)).toBe(false)
	})

	it('is true only for a member (case-insensitive)', () => {
		expect(isDesignatedResolver([A, B], A.toUpperCase())).toBe(true)
		expect(isDesignatedResolver([A, B], C)).toBe(false)
	})
})

describe('isDesignatedOverride', () => {
	it('is false without bypass', () => {
		expect(isDesignatedOverride([A, B], C, false)).toBe(false)
	})

	it('is false when there is no narrowing set (global authority is not an override)', () => {
		expect(isDesignatedOverride(null, A, true)).toBe(false)
		expect(isDesignatedOverride([], A, true)).toBe(false)
	})

	it('is false when the bypassing actor is themselves a designated member', () => {
		expect(isDesignatedOverride([A, B], A, true)).toBe(false)
	})

	it('is true only when bypass overrides a real set the actor is not in', () => {
		expect(isDesignatedOverride([A, B], C, true)).toBe(true)
	})
})
