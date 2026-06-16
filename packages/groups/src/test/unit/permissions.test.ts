import { describe, expect, it } from 'vitest'

import {
	buildStructurePermissionUrn,
	hasAllStructureManagerPermission,
	hasAllStructureSensitivePermission,
	hasAnyStructurePermission,
	hasStructureManagerPermission,
	hasStructureSensitivePermission,
	isStructurePermissionUrn,
	parseStructurePermissionUrn,
} from '../../permissions'

describe('structure permission utilities', () => {
	it('builds and parses all-scope viewer URNs', () => {
		const urn = buildStructurePermissionUrn('all', 'viewer')

		expect(urn).toBe('urn:structures:all:viewer')
		expect(isStructurePermissionUrn(urn)).toBe(true)
		expect(parseStructurePermissionUrn(urn)).toEqual({
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
			scope: 'corp',
			corporationId: '1234567890',
			role: 'manager',
		})
	})

	it('builds and parses corporation-scoped sensitive URNs', () => {
		const urn = buildStructurePermissionUrn('1234567890', 'sensitive')

		expect(urn).toBe('urn:structures:1234567890:sensitive')
		expect(isStructurePermissionUrn(urn)).toBe(true)
		expect(parseStructurePermissionUrn(urn)).toEqual({
			scope: 'corp',
			corporationId: '1234567890',
			role: 'sensitive',
		})
	})

	it('rejects malformed or non-structure URNs', () => {
		expect(isStructurePermissionUrn('urn:srp:reviewer')).toBe(false)
		expect(parseStructurePermissionUrn('urn:srp:reviewer')).toBeNull()
		expect(parseStructurePermissionUrn('urn:structures:all:not-a-role')).toBeNull()
		expect(parseStructurePermissionUrn('urn:structures:')).toBeNull()
	})

	it('only treats syntactically valid structure URNs as structure access', () => {
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:all:viewer' }])).toBe(true)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:1001:viewer' }])).toBe(true)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:all:view' }])).toBe(false)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:all:manager' }])).toBe(true)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:1001:sensitive' }])).toBe(true)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:all:not-a-role' }])).toBe(false)
		expect(hasAnyStructurePermission([{ urn: 'urn:structures:' }])).toBe(false)
		expect(hasAnyStructurePermission([{ urn: 'urn:srp:reviewer' }])).toBe(false)
		expect(hasAnyStructurePermission([])).toBe(false)
	})

	it('only treats manager structure URNs as manager access', () => {
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:all:viewer' }])).toBe(false)
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:1001:viewer' }])).toBe(false)
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:all:manager' }])).toBe(true)
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:1001:manager' }])).toBe(true)
		expect(hasStructureManagerPermission([{ urn: 'urn:structures:1001:sensitive' }])).toBe(false)
		expect(hasStructureManagerPermission([{ urn: 'urn:srp:reviewer' }])).toBe(false)
	})

	it('treats sensitive structure URNs as read-only sensitive access', () => {
		expect(hasStructureSensitivePermission([{ urn: 'urn:structures:all:viewer' }])).toBe(false)
		expect(hasStructureSensitivePermission([{ urn: 'urn:structures:1001:viewer' }])).toBe(false)
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
