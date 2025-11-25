import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'

import type { Env } from '../../../context'

export type OrdersData = Awaited<ReturnType<typeof esiFetch.fetchOrders>>

export async function fetchOrders(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<OrdersData> {
	const tokenStore = createTokenStore(env)
	const orders = await esiFetch.fetchOrders(tokenStore, corporationId, directorCharacterId)

	logger.debug('[OrdersStep] Fetched orders', { corporationId, count: orders.length })

	return orders
}

export async function storeOrders(env: Env, corporationId: string, orders: OrdersData): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.storeOrders(corporationId, orders)

	logger.info('[OrdersStep] Stored orders', { corporationId, count: orders.length })
}

