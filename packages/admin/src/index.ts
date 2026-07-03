/**
 * Admin RPC Interface Types
 * Shared between admin worker and core worker for type-safe RPC calls
 */

/**
 * Admin audit log action types
 */
export type AdminAction =
	| 'admin_user_deleted'
	| 'admin_character_deleted'
	| 'admin_character_transferred'
	| 'admin_user_viewed'
	| 'admin_character_viewed'

/**
 * Result types for admin operations
 */
export interface DeleteUserResult {
	success: boolean
	deletedUserId: string
	deletedCharacterIds: string[]
	tokensRevoked: number
}

export interface TransferCharacterResult {
	success: boolean
	characterId: string
	oldUserId: string
	newUserId: string
	tokensRevoked: boolean
}

export interface DeleteCharacterResult {
	success: boolean
	characterId: string
	userId: string
	tokensRevoked: boolean
}

/**
 * User summary for search results
 */
export interface UserSummary {
	id: string
	mainCharacterId: string
	mainCharacterName: string | null
	characterCount: number
	is_admin: boolean
	discordUserId: string | null
	discordUsername: string | null
	matchedCharacterId: string | null
	matchedCharacterName: string | null
	matchedBy:
		| 'main_character_name'
		| 'character_name'
		| 'character_id'
		| 'user_id'
		| 'discord_user_id'
		| 'discord_username'
		| 'legacy_auth_username'
		| null
	createdAt: Date
	updatedAt: Date
}

/**
 * Search users parameters
 */
export interface SearchUsersParams {
	search?: string
	isAdmin?: boolean
	limit?: number
	offset?: number
}

/**
 * Search users result
 */
export interface SearchUsersResult {
	users: UserSummary[]
	total: number
	limit: number
	offset: number
}

/**
 * Character summary for user details
 */
export interface CharacterSummary {
	characterId: string
	characterName: string
	characterOwnerHash: string
	corporationId?: string | null
	corporationName?: string | null
	is_primary: boolean
	linkedAt: Date
	hasValidToken: boolean
	isBlacklisted: boolean
}

/**
 * Discord status info for user details
 */
export interface DiscordStatus {
	userId: string
	username: string
	discriminator: string
	authRevoked: boolean
	authRevokedAt: Date | null
	lastSuccessfulAuth: Date | null
}

export type UserGroupMembershipLevel = 'member' | 'admin' | 'owner'

export type ResolvedPermissionGrantSource = 'global' | 'group_scoped'

export type ResolvedPermissionGrantTargetType =
	| 'all_members'
	| 'all_admins'
	| 'owner_only'
	| 'owner_and_admins'

export interface ResolvedPermissionGrant {
	permissionId?: string | null
	urn: string
	name: string
	description: string | null
	groupId: string
	groupName: string
	targetType: ResolvedPermissionGrantTargetType
	source: ResolvedPermissionGrantSource
}

export interface UserGroupMembershipSummary {
	groupId: string
	groupName: string
	membershipLevel: UserGroupMembershipLevel
	joinedAt: Date
}

/**
 * User details with all characters
 */
export interface UserDetails {
	id: string
	mainCharacterId: string
	is_admin: boolean
	discordUserId: string | null
	discord: DiscordStatus | null
	characters: CharacterSummary[]
	groupMemberships: UserGroupMembershipSummary[]
	permissionGrants: ResolvedPermissionGrant[]
	createdAt: Date
	updatedAt: Date
}

/**
 * Character ownership info
 */
export interface CharacterOwnerInfo {
	userId: string
	isPrimary: boolean
	linkedAt: Date
}

/**
 * Character public info
 */
export interface CharacterPublicInfo {
	corporationId?: string
	corporationName?: string
	allianceId?: string
	allianceName?: string
	securityStatus?: number
	birthday?: Date
	[key: string]: unknown
}

/**
 * Character details with ownership
 */
export interface CharacterDetails {
	characterId: string
	characterName: string
	owner: CharacterOwnerInfo | null
	publicInfo: CharacterPublicInfo
	hasValidToken: boolean
	lastUpdated: Date | null
}

/**
 * Admin audit log entry
 */
export interface AdminAuditLogEntry {
	id: string
	adminUserId: string
	action: AdminAction
	targetUserId: string | null
	targetCharacterId: string | null
	metadata: Record<string, unknown> | null
	timestamp: Date
	ip: string | null
	userAgent: string | null
}

/**
 * Activity log filters
 */
export interface ActivityLogFilters {
	limit?: number
	offset?: number
	action?: AdminAction
	adminUserId?: string
}

/**
 * Activity log result
 */
export interface ActivityLogResult {
	logs: AdminAuditLogEntry[]
	total: number
	limit: number
	offset: number
}

/**
 * Core Worker RPC Interface
 * This interface defines all RPC methods exposed by the core worker
 * These methods provide direct access to user/character data without audit logging
 */
export interface CoreWorker {
	/**
	 * Search users with pagination
	 */
	searchUsers(params: SearchUsersParams): Promise<SearchUsersResult>

	/**
	 * Get detailed user information
	 */
	getUserDetails(userId: string): Promise<UserDetails | null>

	/**
	 * Get all active linked character IDs for a user.
	 */
	getUserCharacterIds(userId: string): Promise<string[]>

	/**
	 * Delete a user and all associated data
	 */
	deleteUser(userId: string): Promise<DeleteUserResult>

	/**
	 * Transfer character ownership from one user to another
	 */
	transferCharacterOwnership(
		characterId: string,
		newUserId: string
	): Promise<TransferCharacterResult>

	/**
	 * Delete/unlink a character from its owner
	 */
	deleteCharacter(characterId: string): Promise<DeleteCharacterResult>

	/**
	 * Get character ownership information
	 */
	getCharacterOwnership(characterId: string): Promise<CharacterOwnerInfo | null>
}

/**
 * Admin Worker RPC Interface
 * This interface defines all RPC methods exposed by the admin worker
 */
export interface AdminWorker {
	/**
	 * Delete a user and all associated data
	 */
	deleteUser(userId: string, adminUserId: string): Promise<DeleteUserResult>

	/**
	 * Transfer character ownership from one user to another
	 */
	transferCharacterOwnership(
		characterId: string,
		newUserId: string,
		adminUserId: string
	): Promise<TransferCharacterResult>

	/**
	 * Delete/unlink a character from its owner
	 */
	deleteCharacter(characterId: string, adminUserId: string): Promise<DeleteCharacterResult>

	/**
	 * Search users with pagination
	 */
	searchUsers(params: SearchUsersParams, adminUserId: string): Promise<SearchUsersResult>

	/**
	 * Get detailed user information
	 */
	getUserDetails(userId: string, adminUserId: string): Promise<UserDetails | null>

	/**
	 * Get detailed character information with ownership
	 */
	getCharacterDetails(characterId: string, adminUserId: string): Promise<CharacterDetails | null>

	/**
	 * Get admin activity log with filters
	 */
	getActivityLog(filters: ActivityLogFilters, adminUserId: string): Promise<ActivityLogResult>
}

/**
 * OAuth client summary exposed by the third-party apps RPC surface.
 */
export const THIRD_PARTY_APP_IDENTITY_SCOPES = ['profile', 'groups', 'permissions'] as const

export const THIRD_PARTY_APP_ESI_SCOPES = [
	'esi:esi-alliances.read_contacts.v1',
	'esi:esi-assets.read_assets.v1',
	'esi:esi-assets.read_corporation_assets.v1',
	'esi:esi-calendar.read_calendar_events.v1',
	'esi:esi-calendar.respond_calendar_events.v1',
	'esi:esi-characters.read_agents_research.v1',
	'esi:esi-characters.read_blueprints.v1',
	'esi:esi-characters.read_contacts.v1',
	'esi:esi-characters.read_corporation_roles.v1',
	'esi:esi-characters.read_fatigue.v1',
	'esi:esi-characters.read_fw_stats.v1',
	'esi:esi-characters.read_loyalty.v1',
	'esi:esi-characters.read_medals.v1',
	'esi:esi-characters.read_notifications.v1',
	'esi:esi-characters.read_standings.v1',
	'esi:esi-characters.read_titles.v1',
	'esi:esi-characters.write_contacts.v1',
	'esi:esi-clones.read_clones.v1',
	'esi:esi-clones.read_implants.v1',
	'esi:esi-contracts.read_character_contracts.v1',
	'esi:esi-contracts.read_corporation_contracts.v1',
	'esi:esi-corporations.read_blueprints.v1',
	'esi:esi-corporations.read_contacts.v1',
	'esi:esi-corporations.read_container_logs.v1',
	'esi:esi-corporations.read_corporation_membership.v1',
	'esi:esi-corporations.read_divisions.v1',
	'esi:esi-corporations.read_facilities.v1',
	'esi:esi-corporations.read_fw_stats.v1',
	'esi:esi-corporations.read_medals.v1',
	'esi:esi-corporations.read_standings.v1',
	'esi:esi-corporations.read_starbases.v1',
	'esi:esi-corporations.read_structures.v1',
	'esi:esi-corporations.read_titles.v1',
	'esi:esi-corporations.track_members.v1',
	'esi:esi-fittings.read_fittings.v1',
	'esi:esi-fittings.write_fittings.v1',
	'esi:esi-fleets.read_fleet.v1',
	'esi:esi-fleets.write_fleet.v1',
	'esi:esi-industry.read_character_jobs.v1',
	'esi:esi-industry.read_character_mining.v1',
	'esi:esi-industry.read_corporation_jobs.v1',
	'esi:esi-industry.read_corporation_mining.v1',
	'esi:esi-killmails.read_corporation_killmails.v1',
	'esi:esi-killmails.read_killmails.v1',
	'esi:esi-location.read_location.v1',
	'esi:esi-location.read_online.v1',
	'esi:esi-location.read_ship_type.v1',
	'esi:esi-mail.organize_mail.v1',
	'esi:esi-mail.read_mail.v1',
	'esi:esi-mail.send_mail.v1',
	'esi:esi-markets.read_character_orders.v1',
	'esi:esi-markets.read_corporation_orders.v1',
	'esi:esi-markets.structure_markets.v1',
	'esi:esi-planets.manage_planets.v1',
	'esi:esi-planets.read_customs_offices.v1',
	'esi:esi-search.search_structures.v1',
	'esi:esi-skills.read_skillqueue.v1',
	'esi:esi-skills.read_skills.v1',
	'esi:esi-ui.open_window.v1',
	'esi:esi-ui.write_waypoint.v1',
	'esi:esi-universe.read_structures.v1',
	'esi:esi-wallet.read_character_wallet.v1',
	'esi:esi-wallet.read_corporation_wallets.v1',
] as const

export const THIRD_PARTY_APP_SUPPORTED_SCOPES = [
	...THIRD_PARTY_APP_IDENTITY_SCOPES,
	...THIRD_PARTY_APP_ESI_SCOPES,
] as const

export type ThirdPartyAppScope = (typeof THIRD_PARTY_APP_SUPPORTED_SCOPES)[number]

export type ThirdPartyAppScopeCategory = 'identity' | 'esi'

export interface ThirdPartyAppScopeMetadata {
	scope: ThirdPartyAppScope
	category: ThirdPartyAppScopeCategory
	name: string
	description: string
}

const IDENTITY_SCOPE_METADATA = {
	profile: {
		category: 'identity',
		name: 'Profile',
		description: 'Read the signed-in account identity and linked character summary.',
	},
	groups: {
		category: 'identity',
		name: 'Groups',
		description: 'Read group memberships attached to the signed-in account.',
	},
	permissions: {
		category: 'identity',
		name: 'Permissions',
		description: 'Read permission grants attached to the signed-in account.',
	},
} as const satisfies Record<
	(typeof THIRD_PARTY_APP_IDENTITY_SCOPES)[number],
	Omit<ThirdPartyAppScopeMetadata, 'scope'>
>

const ESI_DOMAIN_LABELS: Record<string, string> = {
	alliances: 'Alliance contacts',
	assets: 'Assets',
	calendar: 'Calendar',
	characters: 'Character data',
	clones: 'Clones',
	contracts: 'Contracts',
	corporations: 'Corporation data',
	fittings: 'Fittings',
	fleets: 'Fleets',
	industry: 'Industry',
	killmails: 'Killmails',
	location: 'Location',
	mail: 'Mail',
	markets: 'Markets',
	planets: 'Planetary interaction',
	search: 'Search',
	skills: 'Skills',
	ui: 'EVE client UI',
	universe: 'Universe',
	wallet: 'Wallet',
}

function titleCase(value: string): string {
	return value
		.split(/[_-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ')
}

function parseEsiScope(scope: (typeof THIRD_PARTY_APP_ESI_SCOPES)[number]): {
	domain: string
	action: string
} {
	const match = scope.match(/^esi:esi-([^.]+)\.([^.]+)\.v\d+$/)
	return {
		domain: match?.[1] ?? 'esi',
		action: match?.[2] ?? scope,
	}
}

function describeEsiAction(action: string): string {
	if (action.startsWith('read_')) return `Read ${action.slice('read_'.length).replaceAll('_', ' ')}.`
	if (action.startsWith('write_')) return `Modify ${action.slice('write_'.length).replaceAll('_', ' ')}.`
	if (action.startsWith('send_')) return `Send ${action.slice('send_'.length).replaceAll('_', ' ')}.`
	if (action.startsWith('respond_')) return `Respond to ${action.slice('respond_'.length).replaceAll('_', ' ')}.`
	if (action.startsWith('track_')) return `Track ${action.slice('track_'.length).replaceAll('_', ' ')}.`
	if (action.startsWith('open_')) return `Open ${action.slice('open_'.length).replaceAll('_', ' ')} in the EVE client.`
	if (action.startsWith('manage_')) return `Manage ${action.slice('manage_'.length).replaceAll('_', ' ')}.`
	if (action.startsWith('organize_')) return `Organize ${action.slice('organize_'.length).replaceAll('_', ' ')}.`
	return titleCase(action)
}

function buildEsiScopeMetadata(scope: (typeof THIRD_PARTY_APP_ESI_SCOPES)[number]): ThirdPartyAppScopeMetadata {
	const { domain, action } = parseEsiScope(scope)
	const domainLabel = ESI_DOMAIN_LABELS[domain] ?? titleCase(domain)
	const actionLabel = titleCase(action)
	return {
		scope,
		category: 'esi',
		name: `${domainLabel}: ${actionLabel}`,
		description: `Allows the application to ${describeEsiAction(action).toLowerCase()} Requests are proxied through the configured ESI character context.`,
	}
}

export const THIRD_PARTY_APP_SCOPE_METADATA = Object.fromEntries([
	...THIRD_PARTY_APP_IDENTITY_SCOPES.map((scope) => [
		scope,
		{ scope, ...IDENTITY_SCOPE_METADATA[scope] },
	]),
	...THIRD_PARTY_APP_ESI_SCOPES.map((scope) => [scope, buildEsiScopeMetadata(scope)]),
]) as Record<ThirdPartyAppScope, ThirdPartyAppScopeMetadata>

export function getThirdPartyAppScopeMetadata(scope: string): ThirdPartyAppScopeMetadata {
	if (scope in THIRD_PARTY_APP_SCOPE_METADATA) {
		return THIRD_PARTY_APP_SCOPE_METADATA[scope as ThirdPartyAppScope]
	}
	return {
		scope: scope as ThirdPartyAppScope,
		category: scope.startsWith('esi:') ? 'esi' : 'identity',
		name: scope,
		description: 'Requested by the application.',
	}
}

export interface OAuthClientSummary {
	clientId: string
	clientSecret?: string
	clientName?: string
	redirectUris?: string[]
	scopes?: ThirdPartyAppScope[]
	tokenEndpointAuthMethod?: string
	grantTypes?: string[]
	responseTypes?: string[]
	createdAt?: string
	updatedAt?: string
}

/**
 * Pagination parameters for listing OAuth clients.
 */
export interface OAuthClientListOptions {
	limit?: number
	cursor?: string
}

/**
 * Result of listing OAuth clients.
 */
export interface OAuthClientListResult {
	items: OAuthClientSummary[]
	cursor?: string
}

/**
 * Input for creating a third-party OAuth client.
 */
export interface OAuthClientCreateInput {
	clientName: string
	redirectUris: string[]
	scopes: ThirdPartyAppScope[]
	tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post' | 'none'
	grantTypes: string[]
	responseTypes: string[]
}

/**
 * Input for updating a third-party OAuth client.
 */
export interface OAuthClientUpdateInput {
	clientName?: string
	redirectUris?: string[]
	scopes?: ThirdPartyAppScope[]
	tokenEndpointAuthMethod?: 'client_secret_basic' | 'client_secret_post' | 'none'
	grantTypes?: string[]
	responseTypes?: string[]
}

/**
 * Result of regenerating a client secret.
 */
export interface OAuthClientSecretResult {
	clientId: string
	clientSecret: string
}

export interface OAuthSessionCharacter {
	id: string
	characterOwnerHash: string
	characterId: string
	characterName: string
	isPrimary: boolean
	hasValidToken: boolean
}

export interface OAuthSessionUser {
	id: string
	mainCharacterId: string
	isAdmin: boolean
	characters: OAuthSessionCharacter[]
	sessionCreatedAt?: string
}

export interface OAuthAuthorizationPreview {
	clientId: string
	clientName: string | null
	scope: string[]
	state: string | null
	requiresFreshSession?: boolean
}

export interface OAuthAuthorizationResult {
	redirectTo: string
}

export type OAuthAuthorizationAction = 'approve' | 'deny'

/**
 * Third-party apps RPC interface.
 * Core uses this to manage OAuth clients without depending on provider internals.
 */
export interface ThirdPartyAppsAdminWorker {
	listClients(options?: OAuthClientListOptions): Promise<OAuthClientListResult>
	createClient(input: OAuthClientCreateInput): Promise<OAuthClientSummary>
	updateClient(
		clientId: string,
		input: OAuthClientUpdateInput
	): Promise<OAuthClientSummary | null>
	deleteClient(clientId: string): Promise<void>
	regenerateClientSecret(clientId: string): Promise<OAuthClientSecretResult | null>
	previewAuthorization(
		requestUrl: string,
		expectedOrigin: string
	): Promise<OAuthAuthorizationPreview | null>
	resolveAuthorization(
		requestUrl: string,
		expectedOrigin: string,
		user: OAuthSessionUser,
		action: OAuthAuthorizationAction
	): Promise<OAuthAuthorizationResult | null>
}
