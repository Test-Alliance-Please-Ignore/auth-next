import { DurableObject } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { GetRegionMarketDataInput, GetRegionMarketDataResponse, Markets } from '@repo/markets'
import type { Env } from './context'

const AUTH_CHARACTER_ID = '2114114257' // Test Auth character

/**
 * Markets Durable Object
 */
export class MarketsDO extends DurableObject<Env, {}> implements Markets {
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
	}

	async fetch(request: Request): Promise<Response> {
		return new Response('Markets Durable Object', { status: 200 })
	}
}
