import { isTaxDemoModeEnabled, resolveDemoEntityNames } from '@/dev/tax-demo-mode'

import { ApiClient } from './api'

export type EntityNamesResponse = Record<string, string>

const ENTITY_API_BASE = '/entities'

class EntityApiClient extends ApiClient {
	async resolveEntityNames(input: { ids: string[] }): Promise<EntityNamesResponse> {
		if (isTaxDemoModeEnabled()) {
			return Promise.resolve(resolveDemoEntityNames(input.ids))
		}
		return this.post(`${ENTITY_API_BASE}/names`, input)
	}
}

export const entityApi = new EntityApiClient()
