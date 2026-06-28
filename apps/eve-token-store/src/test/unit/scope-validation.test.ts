import { describe, expect, it } from 'vitest'

import { EVE_SSO_SCOPES_ALL, getMissingScopes, hasAllScopes } from '@repo/eve-token-store'

describe('token scope validation', () => {
	it('computes missing scopes against the canonical full scope set', () => {
		const grantedScopes = EVE_SSO_SCOPES_ALL.slice(0, -1)
		const missingScopes = getMissingScopes(grantedScopes)

		expect(missingScopes).toEqual([EVE_SSO_SCOPES_ALL[EVE_SSO_SCOPES_ALL.length - 1]])
		expect(hasAllScopes(grantedScopes)).toBe(false)
	})

	it('accepts the canonical full scope set', () => {
		expect(getMissingScopes([...EVE_SSO_SCOPES_ALL])).toEqual([])
		expect(hasAllScopes([...EVE_SSO_SCOPES_ALL])).toBe(true)
	})

	it('includes the structure read scopes required for corp structure enrichment', () => {
		expect(EVE_SSO_SCOPES_ALL).toContain('esi-universe.read_structures.v1')
		expect(EVE_SSO_SCOPES_ALL).toContain('esi-structures.read_corporation.v1')
		expect(EVE_SSO_SCOPES_ALL).toContain('esi-corporations.read_structures.v1')
	})
})
