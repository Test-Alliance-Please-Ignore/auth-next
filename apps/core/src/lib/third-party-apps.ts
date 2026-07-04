import type { App } from '../context'

export function getThirdPartyAppsClient(env?: Partial<App['Bindings']> | null) {
	return env?.THIRD_PARTY_APPS ?? null
}

export function getThirdPartyAppsFetchBinding(env?: Partial<App['Bindings']> | null) {
	const binding = env?.THIRD_PARTY_APPS as unknown as
		| {
				fetch(request: Request): Promise<Response>
		  }
		| undefined
	if (!binding?.fetch) {
		return null
	}
	return binding
}
