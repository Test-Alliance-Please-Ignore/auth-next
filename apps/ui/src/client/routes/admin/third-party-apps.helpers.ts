import type { ThirdPartyAppScopeMetadata } from '@repo/admin'

export type ThirdPartyAppScopeAccessLevel = 'read' | 'write'

export interface ThirdPartyAppScopeRow extends ThirdPartyAppScopeMetadata {
	accessLevel: ThirdPartyAppScopeAccessLevel
	domainKey: string | null
	domainLabel: string | null
}

export interface ThirdPartyAppScopeDomainGroup {
	key: string
	label: string
	scopes: ThirdPartyAppScopeRow[]
}

export interface ThirdPartyAppScopeSectionGroup {
	key: 'auth-platform' | 'esi-proxy'
	label: string
	description: string
	scopes: ThirdPartyAppScopeRow[]
	domainGroups: ThirdPartyAppScopeDomainGroup[]
}

export const THIRD_PARTY_APP_REQUIRED_SCOPES = ['profile'] as const

const ESI_SCOPE_PATTERN = /^esi:esi-([^.]+)\.([^.]+)\.v\d+$/

function titleCase(value: string): string {
	return value
		.split(/[_-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ')
}

export function getThirdPartyAppScopeAccessLevel(scope: string): ThirdPartyAppScopeAccessLevel {
	const match = scope.match(ESI_SCOPE_PATTERN)
	if (!match) {
		return 'read'
	}

	const action = match[2]
	return action.startsWith('read_') ? 'read' : 'write'
}

export function getThirdPartyAppScopeRow(
	scopeOption: ThirdPartyAppScopeMetadata
): ThirdPartyAppScopeRow {
	if (scopeOption.category !== 'esi') {
		return {
			...scopeOption,
			accessLevel: 'read',
			domainKey: null,
			domainLabel: null,
		}
	}

	const match = scopeOption.scope.match(ESI_SCOPE_PATTERN)
	const domainKey = match?.[1] ?? null
	const domainLabel = scopeOption.name.includes(':')
		? scopeOption.name.split(':', 1)[0]?.trim() ?? null
		: titleCase(domainKey ?? '') || null

	return {
		...scopeOption,
		accessLevel: getThirdPartyAppScopeAccessLevel(scopeOption.scope),
		domainKey,
		domainLabel,
	}
}

export function groupThirdPartyAppScopeOptions(
	scopeOptions: ThirdPartyAppScopeMetadata[]
): ThirdPartyAppScopeSectionGroup[] {
	const authPlatformScopes = scopeOptions
		.filter((scopeOption) => scopeOption.category === 'identity')
		.map(getThirdPartyAppScopeRow)

	const esiDomainGroups = new Map<string, ThirdPartyAppScopeDomainGroup>()
	for (const scopeOption of scopeOptions) {
		if (scopeOption.category !== 'esi') continue

		const row = getThirdPartyAppScopeRow(scopeOption)
		const groupKey = row.domainKey ?? 'esi'
		const groupLabel = row.domainLabel ?? titleCase(groupKey)
		const existing = esiDomainGroups.get(groupKey)
		if (existing) {
			existing.scopes.push(row)
		} else {
			esiDomainGroups.set(groupKey, {
				key: groupKey,
				label: groupLabel,
				scopes: [row],
			})
		}
	}

	const esiProxyScopes = [...esiDomainGroups.values()].flatMap((group) => group.scopes)

	return [
		{
			key: 'auth-platform',
			label: 'Auth Platform Scopes',
			description: 'Scopes for account identity, groups, and permissions inside this platform.',
			scopes: authPlatformScopes,
			domainGroups: [],
		},
		{
			key: 'esi-proxy',
			label: 'ESI Proxy Scopes',
			description: 'Scopes forwarded to EVE ESI through the configured proxy context.',
			scopes: esiProxyScopes,
			domainGroups: [...esiDomainGroups.values()],
		},
	]
}
