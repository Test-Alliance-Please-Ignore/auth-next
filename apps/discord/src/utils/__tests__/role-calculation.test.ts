import { describe, expect, it } from 'vitest'
import { calculateRoleChanges } from '../role-calculation'

describe('calculateRoleChanges', () => {
	describe('Add-only mode (isAddOnlyMode: true)', () => {
		it('should merge current and requested roles without duplicates', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['role1', 'role2'],
				requestedRoleIds: ['role3', 'role4'],
				managedRoleIds: ['role1', 'role3'],
				isAddOnlyMode: true,
			})

			expect(result.newRoleIds).toHaveLength(4)
			expect(result.newRoleIds).toEqual(
				expect.arrayContaining(['role1', 'role2', 'role3', 'role4'])
			)
			expect(result.rolesAdded).toEqual(expect.arrayContaining(['role3', 'role4']))
			expect(result.rolesAdded).toHaveLength(2)
			expect(result.rolesRemoved).toEqual([])
		})

		it('should never remove any roles', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['role1', 'role2', 'role3'],
				requestedRoleIds: ['role1'],
				managedRoleIds: ['role1', 'role2', 'role3'],
				isAddOnlyMode: true,
			})

			expect(result.newRoleIds).toHaveLength(3)
			expect(result.newRoleIds).toEqual(
				expect.arrayContaining(['role1', 'role2', 'role3'])
			)
			expect(result.rolesAdded).toEqual([])
			expect(result.rolesRemoved).toEqual([])
		})

		it('should handle overlapping role IDs', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['role1', 'role2'],
				requestedRoleIds: ['role2', 'role3'],
				managedRoleIds: ['role2'],
				isAddOnlyMode: true,
			})

			expect(result.newRoleIds).toHaveLength(3)
			expect(result.newRoleIds).toEqual(
				expect.arrayContaining(['role1', 'role2', 'role3'])
			)
			expect(result.rolesAdded).toEqual(['role3'])
			expect(result.rolesRemoved).toEqual([])
		})

		it('should handle empty current roles', () => {
			const result = calculateRoleChanges({
				currentRoleIds: [],
				requestedRoleIds: ['role1', 'role2'],
				managedRoleIds: ['role1'],
				isAddOnlyMode: true,
			})

			expect(result.newRoleIds).toEqual(['role1', 'role2'])
			expect(result.rolesAdded).toEqual(['role1', 'role2'])
			expect(result.rolesRemoved).toEqual([])
		})

		it('should handle empty requested roles', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['role1', 'role2'],
				requestedRoleIds: [],
				managedRoleIds: ['role1'],
				isAddOnlyMode: true,
			})

			expect(result.newRoleIds).toEqual(['role1', 'role2'])
			expect(result.rolesAdded).toEqual([])
			expect(result.rolesRemoved).toEqual([])
		})

		it('should handle duplicate role IDs in input arrays', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['role1', 'role1', 'role2'],
				requestedRoleIds: ['role3', 'role3'],
				managedRoleIds: ['role1'],
				isAddOnlyMode: true,
			})

			// Should deduplicate all roles
			expect(result.newRoleIds).toHaveLength(3)
			expect(result.newRoleIds).toEqual(
				expect.arrayContaining(['role1', 'role2', 'role3'])
			)
			expect(result.rolesAdded).toEqual(['role3'])
			expect(result.rolesRemoved).toEqual([])
		})

		it('should handle all three arrays empty', () => {
			const result = calculateRoleChanges({
				currentRoleIds: [],
				requestedRoleIds: [],
				managedRoleIds: [],
				isAddOnlyMode: true,
			})

			expect(result.newRoleIds).toEqual([])
			expect(result.rolesAdded).toEqual([])
			expect(result.rolesRemoved).toEqual([])
		})

		it('should add all requested roles when current has complete overlap', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['role1', 'role2'],
				requestedRoleIds: ['role1', 'role2'],
				managedRoleIds: ['role1', 'role2'],
				isAddOnlyMode: true,
			})

			expect(result.newRoleIds).toEqual(['role1', 'role2'])
			expect(result.rolesAdded).toEqual([])
			expect(result.rolesRemoved).toEqual([])
		})
	})

	describe('Managed removal mode (isAddOnlyMode: false)', () => {
		it('should preserve manually-assigned roles (not in managedRoleIds)', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['manual1', 'managed1', 'manual2'],
				requestedRoleIds: ['managed2'],
				managedRoleIds: ['managed1', 'managed2'],
				isAddOnlyMode: false,
			})

			expect(result.newRoleIds).toHaveLength(3)
			expect(result.newRoleIds).toEqual(
				expect.arrayContaining(['manual1', 'manual2', 'managed2'])
			)
			expect(result.rolesAdded).toEqual(['managed2'])
			expect(result.rolesRemoved).toEqual(['managed1'])
		})

		it('should remove managed roles that are not requested', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['role1', 'role2', 'role3'],
				requestedRoleIds: ['role1'],
				managedRoleIds: ['role1', 'role2', 'role3'],
				isAddOnlyMode: false,
			})

			expect(result.newRoleIds).toEqual(['role1'])
			expect(result.rolesAdded).toEqual([])
			expect(result.rolesRemoved).toHaveLength(2)
			expect(result.rolesRemoved).toEqual(
				expect.arrayContaining(['role2', 'role3'])
			)
		})

		it('should add new requested roles', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['role1'],
				requestedRoleIds: ['role1', 'role2', 'role3'],
				managedRoleIds: ['role1', 'role2', 'role3'],
				isAddOnlyMode: false,
			})

			expect(result.newRoleIds).toHaveLength(3)
			expect(result.newRoleIds).toEqual(
				expect.arrayContaining(['role1', 'role2', 'role3'])
			)
			expect(result.rolesAdded).toHaveLength(2)
			expect(result.rolesAdded).toEqual(expect.arrayContaining(['role2', 'role3']))
			expect(result.rolesRemoved).toEqual([])
		})

		it('should handle empty current roles', () => {
			const result = calculateRoleChanges({
				currentRoleIds: [],
				requestedRoleIds: ['role1', 'role2'],
				managedRoleIds: ['role1', 'role2'],
				isAddOnlyMode: false,
			})

			expect(result.newRoleIds).toEqual(['role1', 'role2'])
			expect(result.rolesAdded).toEqual(['role1', 'role2'])
			expect(result.rolesRemoved).toEqual([])
		})

		it('should handle empty requested roles', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['manual1', 'managed1'],
				requestedRoleIds: [],
				managedRoleIds: ['managed1'],
				isAddOnlyMode: false,
			})

			expect(result.newRoleIds).toEqual(['manual1'])
			expect(result.rolesAdded).toEqual([])
			expect(result.rolesRemoved).toEqual(['managed1'])
		})

		it('should handle empty managed roles (all roles are manual)', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['manual1', 'manual2'],
				requestedRoleIds: ['role1'],
				managedRoleIds: [],
				isAddOnlyMode: false,
			})

			// Since managedRoleIds is empty, all current roles are considered manual
			// and should be preserved, plus requested roles added
			expect(result.newRoleIds).toHaveLength(3)
			expect(result.newRoleIds).toEqual(
				expect.arrayContaining(['manual1', 'manual2', 'role1'])
			)
			expect(result.rolesAdded).toEqual(['role1'])
			expect(result.rolesRemoved).toEqual([])
		})

		it('should handle when all current roles are managed', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['managed1', 'managed2', 'managed3'],
				requestedRoleIds: ['managed1'],
				managedRoleIds: ['managed1', 'managed2', 'managed3'],
				isAddOnlyMode: false,
			})

			expect(result.newRoleIds).toEqual(['managed1'])
			expect(result.rolesAdded).toEqual([])
			expect(result.rolesRemoved).toHaveLength(2)
			expect(result.rolesRemoved).toEqual(
				expect.arrayContaining(['managed2', 'managed3'])
			)
		})

		it('should handle when no current roles are managed', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['manual1', 'manual2'],
				requestedRoleIds: ['managed1', 'managed2'],
				managedRoleIds: ['managed1', 'managed2'],
				isAddOnlyMode: false,
			})

			// All current roles are manual, so they're preserved + requested roles added
			expect(result.newRoleIds).toHaveLength(4)
			expect(result.newRoleIds).toEqual(
				expect.arrayContaining(['manual1', 'manual2', 'managed1', 'managed2'])
			)
			expect(result.rolesAdded).toHaveLength(2)
			expect(result.rolesAdded).toEqual(
				expect.arrayContaining(['managed1', 'managed2'])
			)
			expect(result.rolesRemoved).toEqual([])
		})

		it('should handle all three arrays empty', () => {
			const result = calculateRoleChanges({
				currentRoleIds: [],
				requestedRoleIds: [],
				managedRoleIds: [],
				isAddOnlyMode: false,
			})

			expect(result.newRoleIds).toEqual([])
			expect(result.rolesAdded).toEqual([])
			expect(result.rolesRemoved).toEqual([])
		})

		it('should deduplicate results with overlapping roles', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['manual1', 'managed1'],
				requestedRoleIds: ['manual1', 'managed2'],
				managedRoleIds: ['managed1', 'managed2'],
				isAddOnlyMode: false,
			})

			// manual1 appears in both current (as manual) and requested
			// Should only appear once in newRoleIds
			expect(result.newRoleIds).toHaveLength(2)
			expect(result.newRoleIds).toEqual(
				expect.arrayContaining(['manual1', 'managed2'])
			)
			expect(result.rolesAdded).toEqual(['managed2'])
			expect(result.rolesRemoved).toEqual(['managed1'])
		})

		it('should handle duplicate role IDs in input arrays', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['manual1', 'manual1', 'managed1'],
				requestedRoleIds: ['managed2', 'managed2'],
				managedRoleIds: ['managed1', 'managed2'],
				isAddOnlyMode: false,
			})

			expect(result.newRoleIds).toHaveLength(2)
			expect(result.newRoleIds).toEqual(
				expect.arrayContaining(['manual1', 'managed2'])
			)
			expect(result.rolesAdded).toEqual(['managed2'])
			expect(result.rolesRemoved).toEqual(['managed1'])
		})
	})

	describe('Complex scenarios', () => {
		it('should handle mix of operations: preserve manual, remove unused managed, add new managed', () => {
			const result = calculateRoleChanges({
				currentRoleIds: ['manual1', 'manual2', 'managed1', 'managed2'],
				requestedRoleIds: ['managed2', 'managed3'],
				managedRoleIds: ['managed1', 'managed2', 'managed3'],
				isAddOnlyMode: false,
			})

			expect(result.newRoleIds).toHaveLength(4)
			expect(result.newRoleIds).toEqual(
				expect.arrayContaining(['manual1', 'manual2', 'managed2', 'managed3'])
			)
			expect(result.rolesAdded).toEqual(['managed3'])
			expect(result.rolesRemoved).toEqual(['managed1'])
		})

		it('should handle large number of roles', () => {
			const currentRoleIds = Array.from({ length: 50 }, (_, i) => `role${i}`)
			const requestedRoleIds = Array.from({ length: 30 }, (_, i) => `role${i + 25}`)
			const managedRoleIds = Array.from({ length: 40 }, (_, i) => `role${i + 15}`)

			const result = calculateRoleChanges({
				currentRoleIds,
				requestedRoleIds,
				managedRoleIds,
				isAddOnlyMode: false,
			})

			// Verify no duplicates
			const uniqueNewRoles = [...new Set(result.newRoleIds)]
			expect(result.newRoleIds).toHaveLength(uniqueNewRoles.length)

			// Verify all manual roles are preserved (role0-role14)
			for (let i = 0; i < 15; i++) {
				expect(result.newRoleIds).toContain(`role${i}`)
			}

			// Verify all requested roles are present (role25-role54)
			for (let i = 25; i < 55; i++) {
				expect(result.newRoleIds).toContain(`role${i}`)
			}
		})

		it('should maintain consistency between newRoleIds and rolesAdded/rolesRemoved', () => {
			const currentRoleIds = ['role1', 'role2', 'role3']
			const requestedRoleIds = ['role2', 'role4']
			const managedRoleIds = ['role1', 'role2', 'role4']

			const result = calculateRoleChanges({
				currentRoleIds,
				requestedRoleIds,
				managedRoleIds,
				isAddOnlyMode: false,
			})

			// Verify: current - removed + added = new
			const simulatedNewRoles = [
				...currentRoleIds.filter((id) => !result.rolesRemoved.includes(id)),
				...result.rolesAdded,
			]

			expect([...new Set(simulatedNewRoles)].sort()).toEqual(
				[...result.newRoleIds].sort()
			)
		})
	})
})
