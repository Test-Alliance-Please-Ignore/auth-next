/**
 * Authorization helpers for industry order routes
 */

import { getStub } from '@repo/do-utils'
import { EntityType, type Industry, type IndustryOrder, type ServiceProviderId } from '@repo/industry'

import type { Env, SessionUser } from '../context'

/**
 * Check if the user is the issuer of an order
 */
export function isOrderIssuer(order: IndustryOrder, userId: string): boolean {
	return order.issuerEntityType === EntityType.USER && order.issuerEntityId === userId
}

/**
 * Check if the user owns a service provider
 */
export async function isProviderOwner(
	providerId: ServiceProviderId,
	userId: string,
	env: Env
): Promise<boolean> {
	try {
		const industryDO = getStub<Industry>(env.INDUSTRY, 'default')
		const provider = await industryDO.getProvider(providerId)
		return provider.ownerEntityType === EntityType.USER && provider.ownerEntityId === userId
	} catch {
		return false
	}
}

/**
 * Check if the user is the assignee of an order (either directly or via provider ownership)
 */
export async function isOrderAssignee(
	order: IndustryOrder,
	userId: string,
	env: Env
): Promise<boolean> {
	if (!order.assigneeEntityId || !order.assigneeEntityType) {
		return false
	}

	// Direct user assignment
	if (order.assigneeEntityType === EntityType.USER && order.assigneeEntityId === userId) {
		return true
	}

	// Provider ownership
	if (order.assigneeEntityType === EntityType.SERVICE_PROVIDER) {
		return isProviderOwner(order.assigneeEntityId as ServiceProviderId, userId, env)
	}

	return false
}

/**
 * Check if the user can view an order (is issuer OR assignee/provider owner)
 */
export async function canViewOrder(
	order: IndustryOrder,
	userId: string,
	env: Env
): Promise<boolean> {
	// Issuer can always view
	if (isOrderIssuer(order, userId)) {
		return true
	}

	// Assignee/provider owner can view
	return isOrderAssignee(order, userId, env)
}

/**
 * Check if the user can perform issuer actions on an order
 */
export function canPerformIssuerAction(order: IndustryOrder, userId: string): boolean {
	return isOrderIssuer(order, userId)
}

/**
 * Check if the user can perform assignee actions on an order
 */
export async function canPerformAssigneeAction(
	order: IndustryOrder,
	userId: string,
	env: Env
): Promise<boolean> {
	return isOrderAssignee(order, userId, env)
}

/**
 * Get the provider ID owned by the user that can claim an order
 * Returns the first provider owned by the user that offers the order's service type
 */
export async function getClaimableProvider(
	orderType: string,
	userId: string,
	env: Env
): Promise<ServiceProviderId | null> {
	try {
		const industryDO = getStub<Industry>(env.INDUSTRY, 'default')
		const providers = await industryDO.listProviders({
			ownerEntityId: userId,
			ownerEntityType: EntityType.USER,
			acceptingOrders: true,
		})

		// Find a provider that offers this service type
		for (const provider of providers) {
			const services = await industryDO.listProviderServices(provider.id)
			const hasService = services.some(
				(s) => s.serviceType === orderType && s.status === 'active'
			)
			if (hasService) {
				return provider.id
			}
		}

		return null
	} catch {
		return null
	}
}
