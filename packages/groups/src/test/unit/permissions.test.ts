import { describe, expect, it } from 'vitest'

import {
	buildStructurePermissionUrn,
	buildStructureTabPermissionUrn,
	hasAllStructureDetailsPermission,
	hasAllStructureManagerPermission,
	hasAllStructureSensitivePermission,
	hasAnyStructurePermission,
	hasStructureDetailsPermission,
	hasStructureManagerPermission,
	hasStructureSensitivePermission,
	hasStructureTabPermission,
	isStructurePermissionUrn,
	parseStructurePermissionUrn,
} from '../../permissions'

describe('structure permission utilities', () => {
	it('builds and parses all-scope viewer URNs', () => {
		const urn = buildStructurePermissionUrn('all', 'viewer')

		expect(urn).toBe('urn:structures:all:viewer')
		expect(isStructurePermissionUrn(urn)).toBe(true)
		expect(parseStructurePermissionUrn(urn)).toEqual({
			tab: 'all',
			scope: 'all',
			corporationId: null,
			role: 'viewer',
		})
	})

	it('builds and parses corporation-scoped manager URNs', () => {
		const urn = buildStructurePermissionUrn('1234567890', 'manager')

		expect(urn).toBe('urn:structures:1234567890:manager')
		expect(isStructurePermissionUrn(urn)).toBe(true)
		expect(parseStructurePermissionUrn(urn)).toEqual({
			tab: 'all',
			scope: 'corp',
			corporationId: '1234567890',
			role: 'manager',
		})
	})

	it('builds and parses corporation-scoped details URNs', () => {
		const urn = buildStructurePermissionUrn('1234567890', 'details')

		expect(urn).toBe('urn:structures:1234567890:details')
		expect(isStructurePermissionUrn(urn)).toBe(true)
		expect(parseStructurePermissionUrn(urn)).toEqual({
			tab: 'all',
			scope: 'corp',
			corporationId: '1234567890',
			role: 'details',
		})
	})

	it('builds and parses corporation-scoped sensitive URNs', () => {
		const urn = buildStructurePermissionUrn('1234567890', 'sensitive')

		expect(urn).toBe('urn:structures:1234567890:sensitive')
		expect(isStructurePermissionUrn(urn)).toBe(true)
		expect(parseStructurePermissionUrn(urn)).toEqual({
			tab: 'all',
			scope: 'corp',
			corporationId: '1234567890',
			role: 'sensitive',
		})
	})

	it('builds and parses tab-scoped viewer URNs', () => {
		const urn = buildStructureTabPermissionUrn('moon-drills', 'all', 'viewer')

		expect(urn).toBe('urn:structures:moon-drills:all:viewer')
		expect(isStructurePermissionUrn(urn)).toBe(true)
		expect(parseStructurePermissionUrn(urn)).toEqual({
			tab: 'moon-drills',
			scope: 'all',
			corporationId: null,
			role: 'viewer',
		})
	})

	it('builds and parses tab-scoped details URNs', () => {
		const urn = buildStructureTabPermissionUrn('moon-drills', '1234567890', 'details')

		expect(urn).toBe('urn:structures:moon-drills:1234567890:details')
		expect(parseStructurePermissionUrn(urn)).toEqual({
			tab: 'moon-drills',
			scope: 'corp',
			corporationId: '1234567890',
			role: 'details',
		})
	})

	it('builds and parses corp-scoped tab URNs', () => {
		const urn = buildStructureTabPermissionUrn('main', '1234567890', 'manager')

		expect(urn).toBe('urn:structures:main:1234567890:manager')
		expect(parseStructurePermissionUrn(urn)).toEqual({
			tab: 'main',
			scope: 'corp',
			corporationId: '1234567890',
			role: 'manager',
		})
	})

	it.each(['main', 'sovereignty', 'skyhooks', 'moon-drills', 'mining-citadels'] as const)(
		'builds and parses every valid tab scope: %s',
		(tab) => {
			const viewerUrn = buildStructureTabPermissionUrn(tab, 'all', 'viewer')
			const corpUrn = buildStructureTabPermissionUrn(tab, '1234567890', 'manager')

			expect(parseStructurePermissionUrn(viewerUrn)).toEqual({
				tab,
				scope: 'all',
				corporationId: null,
				role: 'viewer',
			})
			expect(parseStructurePermissionUrn(corpUrn)).toEqual({
				tab,
				scope: 'corp',
				corporationId: '1234567890',
				role: 'manager',
			})
			expect(hasStructureTabPermission([{ urn: viewerUrn }], tab)).toBe(true)
			expect(hasStructureTabPermission([{ urn: corpUrn }], tab)).toBe(true)
		}
	)

	it.each(['main', 'sovereignty', 'skyhooks', 'moon-drills', 'mining-citadels'] as const)(
		'treats legacy all-scope permissions as access to every tab: %s',
		(tab) => {
			expect(hasStructureTabPermission([{ urn: 'urn:structures:all:viewer' }], tab)).toBe(true)
			expect(hasStructureTabPermission([{ urn: 'urn:structures:all:manager' }], tab)).toBe(true)
		}
	)

	it('rejects malformed or non-structure URNs', () => {
		expect(isStructurePermissionUrn('urn:srp:reviewer')).toBe(false)
		expect(parseStructurePermissionUrn('urn:srp:reviewer')).toBeNull()
		expect(parseStructurePermissionUrn('urn:structures:all:not-a-role')).toBeNull()
		expect(parseStructurePermissionUrn('urn:structures:not-a-tab:all:viewer')).toBeNull()
		expect(parseStructurePermissionUrn('urn:structures:moon-drills:all:not-a-role')).toBeNull()
		expect(parseStructurePermissionUrn('urn:structures:')).toBeNull()
	})

	it.each(['citadels', 'navigation', 'structures'] as const)(
		'rejects removed structure tab URNs: %s',
		(tab) => {
			expect(parseStructurePermissionUrn(`urn:structures:${tab}:all:viewer`)).toBeNull()
		}
	)

	it('only treats syntactically valid structure URNs as structure access', () => {
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:all:viewer' }])).toBe(true)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:1001:viewer' }])).toBe(true)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:all:view' }])).toBe(false)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:all:details' }])).toBe(true)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:all:manager' }])).toBe(true)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:1001:sensitive' }])).toBe(true)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:moon-drills:all:viewer' }])).toBe(true)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:all:not-a-role' }])).toBe(false)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:' }])).toBe(false)
		expect(hasAnyStructurePermission([{ urn: 'urn:srp:reviewer' }])).toBe(false)
		expect(hasAnyStructurePermission([])).toBe(false)
	})

	it('treats tab-scoped structure URNs as access only for that tab', () => {
		expect(
			hasStructureTabPermission([{ urn: 'urn:structures:moon-drills:all:viewer' }], 'moon-drills')
		).toBe(true)
		expect(
			hasStructureTabPermission([{ urn: 'urn:structures:moon-drills:all:viewer' }], 'structures')
		).toBe(false)
		expect(hasStructureTabPermission([{ urn: 'urn:structures:all:viewer' }], 'structures')).toBe(
			true
		)
	})

	it('only treats manager structure URNs as manager access', () => {
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:all:viewer' }])).toBe(false)
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:1001:viewer' }])).toBe(false)
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:all:details' }])).toBe(false)
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:all:manager' }])).toBe(true)
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:1001:manager' }])).toBe(true)
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:1001:sensitive' }])).toBe(false)
		expect(hasStructureManagerPermission([{ urn: 'urn:srp:reviewer' }])).toBe(false)
	})

	it('treats details structure URNs as read-only detail access', () => {
		expect(hasStructureDetailsPermission([{ urn: 'urn:structures:all:viewer' }])).toBe(false)
		expect(hasStructureDetailsPermission([{ urn: 'urn:structures:1001:viewer' }])).toBe(false)
		expect(hasStructureDetailsPermission([{ urn: 'urn:structures:all:details' }])).toBe(true)
		expect(hasStructureDetailsPermission([{ urn: 'urn:structures:1001:details' }])).toBe(true)
		expect(hasStructureDetailsPermission([{ urn: 'urn:structures:all:sensitive' }])).toBe(true)
		expect(hasStructureDetailsPermission([{ urn: 'urn:structures:1001:sensitive' }])).toBe(true)
		expect(hasStructureDetailsPermission([{ urn: 'urn:structures:all:manager' }])).toBe(true)
		expect(hasStructureDetailsPermission([{ urn: 'urn:srp:reviewer' }])).toBe(false)
	})

	it('treats sensitive structure URNs as read-only sensitive access', () => {
		expect(hasStructureSensitivePermission([{ urn: 'urn:structures:all:viewer' }])).toBe(false)
		expect(hasStructureSensitivePermission([{ urn: 'urn:structures:1001:viewer' }])).toBe(false)
		expect(hasStructureSensitivePermission([{ urn: 'urn:structures:all:details' }])).toBe(false)
		expect(hasStructureSensitivePermission([{ urn: 'urn:structures:all:manager' }])).toBe(true)
		expect(hasStructureSensitivePermission([{ urn: 'urn:structures:1001:manager' }])).toBe(true)
		expect(hasStructureSensitivePermission([{ urn: 'urn:structures:all:sensitive' }])).toBe(true)
		expect(hasStructureSensitivePermission([{ urn: 'urn:structures:1001:sensitive' }])).toBe(true)
		expect(hasStructureSensitivePermission([{ urn: 'urn:srp:reviewer' }])).toBe(false)
	})

	it('treats corp-scoped sensitive URNs as read-only sensitive access without manager access', () => {
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:1001:sensitive' }])).toBe(false)
		expect(hasStructureSensitivePermission([{ urn: 'urn:structures:1001:sensitive' }])).toBe(true)
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:1001:manager' }])).toBe(true)
		expect(hasStructureSensitivePermission([{ urn: 'urn:structures:1001:manager' }])).toBe(true)
	})

	it('only treats all-scope details URNs as all-scope detail access', () => {
		expect(hasAllStructureDetailsPermission([{ urn: 'urn:structures:all:viewer' }])).toBe(false)
		expect(hasAllStructureDetailsPermission([{ urn: 'urn:structures:1001:details' }])).toBe(false)
		expect(hasAllStructureDetailsPermission([{ urn: 'urn:structures:all:details' }])).toBe(true)
		expect(hasAllStructureDetailsPermission([{ urn: 'urn:structures:all:sensitive' }])).toBe(true)
		expect(hasAllStructureDetailsPermission([{ urn: 'urn:structures:all:manager' }])).toBe(true)
		expect(hasAllStructureDetailsPermission([{ urn: 'urn:srp:reviewer' }])).toBe(false)
	})

	it('only treats all-scope manager URNs as manager access', () => {
		expect(hasAllStructureManagerPermission([{ urn: 'urn:structures:all:viewer' }])).toBe(false)
		expect(hasAllStructureManagerPermission([{ urn: 'urn:structures:1001:manager' }])).toBe(false)
		expect(hasAllStructureManagerPermission([{ urn: 'urn:structures:all:manager' }])).toBe(true)
		expect(hasAllStructureManagerPermission([{ urn: 'urn:structures:all:sensitive' }])).toBe(false)
		expect(hasAllStructureManagerPermission([{ urn: 'urn:srp:reviewer' }])).toBe(false)
	})

	it('treats all-scope sensitive URNs as read-only sensitive access', () => {
		expect(hasAllStructureSensitivePermission([{ urn: 'urn:structures:all:viewer' }])).toBe(false)
		expect(hasAllStructureSensitivePermission([{ urn: 'urn:structures:1001:manager' }])).toBe(false)
		expect(hasAllStructureSensitivePermission([{ urn: 'urn:structures:all:manager' }])).toBe(true)
		expect(hasAllStructureSensitivePermission([{ urn: 'urn:structures:all:sensitive' }])).toBe(true)
		expect(hasAllStructureSensitivePermission([{ urn: 'urn:srp:reviewer' }])).toBe(false)
	})
})
