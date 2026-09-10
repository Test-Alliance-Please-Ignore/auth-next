import { getBillingIssuerScopeFromUrns } from '@repo/bills'

export function hasBillingIssuerPermission(
	permissions: ReadonlyArray<{ urn: string }>,
	isAdmin = false
): boolean {
	if (isAdmin) return true
	const scope = getBillingIssuerScopeFromUrns(permissions.map((permission) => permission.urn))
	return scope.unrestricted || scope.corporationIds.length > 0
}
