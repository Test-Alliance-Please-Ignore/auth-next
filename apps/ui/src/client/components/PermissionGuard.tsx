import { AlertCircle } from 'lucide-react'
import { Navigate } from 'react-router'

import { useUserPermissions } from '../hooks/useUserPermissions'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Container } from './ui/container'
import { LoadingPage } from './ui/loading'

interface PermissionGuardProps {
	/**
	 * Required permission URN(s)
	 * If array is provided, user must have ALL permissions
	 */
	permissions: string | string[]

	/**
	 * If true, user needs at least one of the permissions (when array provided)
	 * If false (default), user needs all permissions
	 */
	requireAny?: boolean

	/**
	 * Children to render if permission check passes
	 */
	children: React.ReactNode

	/**
	 * Optional fallback to render instead of redirect
	 * If not provided, redirects to home
	 */
	fallback?: React.ReactNode

	/**
	 * Where to redirect if permission check fails
	 * Default: '/'
	 */
	redirectTo?: string

	/**
	 * If true, shows an error message instead of redirecting
	 */
	showError?: boolean
}

/**
 * Component to guard routes/UI based on permissions
 *
 * @example
 * // Single permission
 * <PermissionGuard permissions="urn:eve:alliance:test-alliance">
 *   <ProtectedContent />
 * </PermissionGuard>
 *
 * @example
 * // Multiple permissions (requires all)
 * <PermissionGuard permissions={["urn:srp:reviewer", "urn:srp:payer"]}>
 *   <SRPAdminPanel />
 * </PermissionGuard>
 *
 * @example
 * // Multiple permissions (requires any)
 * <PermissionGuard permissions={["urn:srp:reviewer", "urn:srp:payer"]} requireAny>
 *   <SRPPanel />
 * </PermissionGuard>
 */
export function PermissionGuard({
	permissions,
	requireAny = false,
	children,
	fallback,
	redirectTo = '/',
	showError = false,
}: PermissionGuardProps) {
	const { hasAnyPermission, hasAllPermissions, isLoading } = useUserPermissions()

	// Show loading state while checking permissions
	if (isLoading) {
		return <LoadingPage />
	}

	// Check permissions
	const permissionArray = Array.isArray(permissions) ? permissions : [permissions]
	const hasAccess = requireAny
		? hasAnyPermission(...permissionArray)
		: hasAllPermissions(...permissionArray)

	// If user has access, render children
	if (hasAccess) {
		return <>{children}</>
	}

	// If fallback provided, render it
	if (fallback) {
		return <>{fallback}</>
	}

	// If showError is true, show error message
	if (showError) {
		return (
			<Container>
				<Card className="border-red-500 bg-red-50 dark:bg-red-950/20">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
							<AlertCircle className="h-5 w-5" />
							Access Denied
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-red-600 dark:text-red-400">
							You don't have permission to access this resource. Please contact an administrator if
							you believe this is an error.
						</p>
					</CardContent>
				</Card>
			</Container>
		)
	}

	// Otherwise redirect
	return <Navigate to={redirectTo} replace />
}
