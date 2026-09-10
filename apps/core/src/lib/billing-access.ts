import { getBillingIssuerScopeFromUrns, isManualBill } from '@repo/bills'
import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

import { getCachedUserPermissions } from './groups-cache'

import type { BillingIssuerScope } from '@repo/bills'
import type { App, SessionUser } from '../context'

export async function hasBillingIssuerPermission(
	env: App['Bindings'],
	userId: string
): Promise<boolean> {
	const scope = await getBillingIssuerScope(env, userId)
	return scope.unrestricted || scope.corporationIds.length > 0
}

export async function hasBaselineBillingIssuerPermission(
	env: App['Bindings'],
	userId: string
): Promise<boolean> {
	const scope = await getBillingIssuerScope(env, userId)
	return scope.unrestricted
}

export async function getBillingIssuerScope(
	env: App['Bindings'],
	userId: string
): Promise<BillingIssuerScope> {
	const permissions = await getCachedUserPermissions(env, userId)
	return getBillingIssuerScopeFromUrns(permissions.map((permission) => permission.urn))
}

export async function canAccessBills(env: App['Bindings'], user: SessionUser): Promise<boolean> {
	return (
		user.is_admin ||
		user.roles.includes(ROLE_CORE_ALLIANCE_MEMBER) ||
		(await hasBillingIssuerPermission(env, user.id))
	)
}

export { isManualBill }
