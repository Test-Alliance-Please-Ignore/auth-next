import { useMemo } from 'react'
import { useAuth } from './useAuth'

/**
 * Hook to get user permissions and check for specific permissions
 * Uses cached auth data for optimal performance
 */
export function useUserPermissions() {
	const { permissions, user, isLoading } = useAuth()

	/**
	 * Check if user has a specific permission by URN
	 */
	const hasPermission = useMemo(() => {
		return (urn: string): boolean => {
			// Admins bypass all permission checks
			if (user?.is_admin) return true

			// Check if user has the specific permission
			return permissions.some(p => p.urn === urn)
		}
	}, [permissions, user])

	/**
	 * Check if user has any of the specified permissions
	 */
	const hasAnyPermission = useMemo(() => {
		return (...urns: string[]): boolean => {
			// Admins bypass all permission checks
			if (user?.is_admin) return true

			// Check if user has any of the permissions
			return urns.some(urn => permissions.some(p => p.urn === urn))
		}
	}, [permissions, user])

	/**
	 * Check if user has all of the specified permissions
	 */
	const hasAllPermissions = useMemo(() => {
		return (...urns: string[]): boolean => {
			// Admins bypass all permission checks
			if (user?.is_admin) return true

			// Check if user has all permissions
			return urns.every(urn => permissions.some(p => p.urn === urn))
		}
	}, [permissions, user])

	return {
		permissions,
		hasPermission,
		hasAnyPermission,
		hasAllPermissions,
		isLoading,
		isAdmin: user?.is_admin ?? false,
	}
}

/**
 * Common permission URNs used throughout the application
 */
export const PERMISSIONS = {
	TEST_ALLIANCE: 'urn:eve:alliance:test-alliance',
	SRP_REVIEWER: 'urn:srp:reviewer',
	SRP_PAYER: 'urn:srp:payer',
	ADMIN: 'urn:admin',
} as const