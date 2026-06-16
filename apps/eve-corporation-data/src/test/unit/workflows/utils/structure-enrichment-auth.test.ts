import { describe, expect, it } from 'vitest'

import { shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure } from '../../../../workflows/utils/structure-enrichment-auth'

describe('shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure', () => {
	it('suppresses scope-gated 401s for corporation structure enrichment endpoints', () => {
		expect(
			shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure(
				new Error(
					'ESI request failed: 401 Unauthorized - {"error":"Unauthorized"} | metadata={"status":401,"path":"/corporations/123/structures/sovereignty-hubs?page=1"}'
				)
			)
		).toBe(true)

		expect(
			shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure(
				new Error(
					'ESI request failed: 401 Unauthorized - {"error":"Unauthorized"} | metadata={"status":401,"path":"/corporations/123/structures/skyhooks/456"}'
				)
			)
		).toBe(true)
	})

	it('also recognizes the character-structure endpoints listed in the OpenAPI spec', () => {
		expect(
			shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure(
				new Error(
					'ESI request failed: 401 Unauthorized - {"error":"Unauthorized"} | metadata={"status":401,"path":"/characters/123/structures/mercenary-dens?page=1"}'
				)
			)
		).toBe(true)
	})

	it('does not suppress other auth failures or unrelated 401s', () => {
		expect(
			shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure(
				new Error(
					'ESI request failed: 403 Forbidden - {"error":"Forbidden"} | metadata={"status":403,"path":"/corporations/123/structures/skyhooks"}'
				)
			)
		).toBe(false)

		expect(
			shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure(
				new Error(
					'ESI request failed: 401 Unauthorized - {"error":"Unauthorized"} | metadata={"status":401,"path":"/corporations/123/assets"}'
				)
			)
		).toBe(false)
	})
})
