import { isTaxDemoModeEnabled, resolveDemoEntityNames } from '@/dev/tax-demo-mode'

import { ApiClient } from './api'

export type EntityNamesResponse = Record<string, string>

const ENTITY_API_BASE = '/entities'

class EntityApiClient extends ApiClient {
	async resolveEntityNames(input: { ids: string[] }): Promise<EntityNamesResponse> {
		if (isTaxDemoModeEnabled()) {
			const demoNames = resolveDemoEntityNames(input.ids)
			const missingIds = input.ids.filter((id) => !(id in demoNames))
			if (missingIds.length === 0) return demoNames
			const realNames = await this.post<EntityNamesResponse>(`${ENTITY_API_BASE}/names`, { ids: missingIds })
			return { ...demoNames, ...realNames }
		}
		return this.post(`${ENTITY_API_BASE}/names`, input)
	}
}

export const entityApi = new EntityApiClient()
