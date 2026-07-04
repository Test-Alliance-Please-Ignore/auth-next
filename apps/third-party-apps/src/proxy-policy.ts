import { createRouter, type MatchedRoute, type RadixRouter } from 'radix3'

import type { ThirdPartyAppScope } from '@repo/admin'

type EsiRouteMethod = 'DELETE' | 'GET' | 'POST' | 'PUT'

type EsiScopeRoute = {
	method: EsiRouteMethod
	template: string
	scope: ThirdPartyAppScope
}

type EsiScopeRouteData = {
	scope: ThirdPartyAppScope
}

const ESI_SCOPE_ROUTES: EsiScopeRoute[] = [
	{ method: 'GET', template: '/:version/alliances/:alliance_id/contacts/', scope: 'esi:esi-alliances.read_contacts.v1' },
	{ method: 'GET', template: '/:version/alliances/:alliance_id/contacts/labels/', scope: 'esi:esi-alliances.read_contacts.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/agents_research/', scope: 'esi:esi-characters.read_agents_research.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/assets/', scope: 'esi:esi-assets.read_assets.v1' },
	{ method: 'POST', template: '/:version/characters/:character_id/assets/locations/', scope: 'esi:esi-assets.read_assets.v1' },
	{ method: 'POST', template: '/:version/characters/:character_id/assets/names/', scope: 'esi:esi-assets.read_assets.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/attributes/', scope: 'esi:esi-skills.read_skills.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/blueprints/', scope: 'esi:esi-characters.read_blueprints.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/calendar/:event_id/attendees/', scope: 'esi:esi-calendar.read_calendar_events.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/calendar/:event_id/', scope: 'esi:esi-calendar.read_calendar_events.v1' },
	{ method: 'PUT', template: '/:version/characters/:character_id/calendar/:event_id/', scope: 'esi:esi-calendar.respond_calendar_events.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/calendar/', scope: 'esi:esi-calendar.read_calendar_events.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/clones/', scope: 'esi:esi-clones.read_clones.v1' },
	{ method: 'DELETE', template: '/:version/characters/:character_id/contacts/', scope: 'esi:esi-characters.write_contacts.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/contacts/', scope: 'esi:esi-characters.read_contacts.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/contacts/labels/', scope: 'esi:esi-characters.read_contacts.v1' },
	{ method: 'POST', template: '/:version/characters/:character_id/contacts/', scope: 'esi:esi-characters.write_contacts.v1' },
	{ method: 'PUT', template: '/:version/characters/:character_id/contacts/', scope: 'esi:esi-characters.write_contacts.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/contracts/:contract_id/bids/', scope: 'esi:esi-contracts.read_character_contracts.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/contracts/:contract_id/items/', scope: 'esi:esi-contracts.read_character_contracts.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/contracts/', scope: 'esi:esi-contracts.read_character_contracts.v1' },
	{ method: 'POST', template: '/:version/characters/:character_id/cspa/', scope: 'esi:esi-characters.read_contacts.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/fatigue/', scope: 'esi:esi-characters.read_fatigue.v1' },
	{ method: 'DELETE', template: '/:version/characters/:character_id/fittings/:fitting_id/', scope: 'esi:esi-fittings.write_fittings.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/fittings/', scope: 'esi:esi-fittings.read_fittings.v1' },
	{ method: 'POST', template: '/:version/characters/:character_id/fittings/', scope: 'esi:esi-fittings.write_fittings.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/fleet/', scope: 'esi:esi-fleets.read_fleet.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/fw/stats/', scope: 'esi:esi-characters.read_fw_stats.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/implants/', scope: 'esi:esi-clones.read_implants.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/industry/jobs/', scope: 'esi:esi-industry.read_character_jobs.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/killmails/recent/', scope: 'esi:esi-killmails.read_killmails.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/location/', scope: 'esi:esi-location.read_location.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/loyalty/points/', scope: 'esi:esi-characters.read_loyalty.v1' },
	{ method: 'DELETE', template: '/:version/characters/:character_id/mail/:mail_id/', scope: 'esi:esi-mail.organize_mail.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/mail/:mail_id/', scope: 'esi:esi-mail.read_mail.v1' },
	{ method: 'PUT', template: '/:version/characters/:character_id/mail/:mail_id/', scope: 'esi:esi-mail.organize_mail.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/mail/', scope: 'esi:esi-mail.read_mail.v1' },
	{ method: 'DELETE', template: '/:version/characters/:character_id/mail/labels/:label_id/', scope: 'esi:esi-mail.organize_mail.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/mail/labels/', scope: 'esi:esi-mail.read_mail.v1' },
	{ method: 'POST', template: '/:version/characters/:character_id/mail/labels/', scope: 'esi:esi-mail.organize_mail.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/mail/lists/', scope: 'esi:esi-mail.read_mail.v1' },
	{ method: 'POST', template: '/:version/characters/:character_id/mail/', scope: 'esi:esi-mail.send_mail.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/medals/', scope: 'esi:esi-characters.read_medals.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/mining/', scope: 'esi:esi-industry.read_character_mining.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/notifications/contacts/', scope: 'esi:esi-characters.read_notifications.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/notifications/', scope: 'esi:esi-characters.read_notifications.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/online/', scope: 'esi:esi-location.read_online.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/orders/', scope: 'esi:esi-markets.read_character_orders.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/orders/history/', scope: 'esi:esi-markets.read_character_orders.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/planets/:planet_id/', scope: 'esi:esi-planets.manage_planets.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/planets/', scope: 'esi:esi-planets.manage_planets.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/roles/', scope: 'esi:esi-characters.read_corporation_roles.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/search/', scope: 'esi:esi-search.search_structures.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/ship/', scope: 'esi:esi-location.read_ship_type.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/skillqueue/', scope: 'esi:esi-skills.read_skillqueue.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/skills/', scope: 'esi:esi-skills.read_skills.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/standings/', scope: 'esi:esi-characters.read_standings.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/titles/', scope: 'esi:esi-characters.read_titles.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/wallet/', scope: 'esi:esi-wallet.read_character_wallet.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/wallet/journal/', scope: 'esi:esi-wallet.read_character_wallet.v1' },
	{ method: 'GET', template: '/:version/characters/:character_id/wallet/transactions/', scope: 'esi:esi-wallet.read_character_wallet.v1' },
	{ method: 'GET', template: '/:version/corporation/:corporation_id/mining/extractions/', scope: 'esi:esi-industry.read_corporation_mining.v1' },
	{ method: 'GET', template: '/:version/corporation/:corporation_id/mining/observers/:observer_id/', scope: 'esi:esi-industry.read_corporation_mining.v1' },
	{ method: 'GET', template: '/:version/corporation/:corporation_id/mining/observers/', scope: 'esi:esi-industry.read_corporation_mining.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/assets/', scope: 'esi:esi-assets.read_corporation_assets.v1' },
	{ method: 'POST', template: '/:version/corporations/:corporation_id/assets/locations/', scope: 'esi:esi-assets.read_corporation_assets.v1' },
	{ method: 'POST', template: '/:version/corporations/:corporation_id/assets/names/', scope: 'esi:esi-assets.read_corporation_assets.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/blueprints/', scope: 'esi:esi-corporations.read_blueprints.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/contacts/', scope: 'esi:esi-corporations.read_contacts.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/contacts/labels/', scope: 'esi:esi-corporations.read_contacts.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/containers/logs/', scope: 'esi:esi-corporations.read_container_logs.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/contracts/:contract_id/bids/', scope: 'esi:esi-contracts.read_corporation_contracts.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/contracts/:contract_id/items/', scope: 'esi:esi-contracts.read_corporation_contracts.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/contracts/', scope: 'esi:esi-contracts.read_corporation_contracts.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/customs_offices/', scope: 'esi:esi-planets.read_customs_offices.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/divisions/', scope: 'esi:esi-corporations.read_divisions.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/facilities/', scope: 'esi:esi-corporations.read_facilities.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/fw/stats/', scope: 'esi:esi-corporations.read_fw_stats.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/industry/jobs/', scope: 'esi:esi-industry.read_corporation_jobs.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/killmails/recent/', scope: 'esi:esi-killmails.read_corporation_killmails.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/medals/', scope: 'esi:esi-corporations.read_medals.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/medals/issued/', scope: 'esi:esi-corporations.read_medals.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/members/', scope: 'esi:esi-corporations.read_corporation_membership.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/members/limit/', scope: 'esi:esi-corporations.track_members.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/members/titles/', scope: 'esi:esi-corporations.read_titles.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/membertracking/', scope: 'esi:esi-corporations.track_members.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/orders/', scope: 'esi:esi-markets.read_corporation_orders.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/orders/history/', scope: 'esi:esi-markets.read_corporation_orders.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/roles/', scope: 'esi:esi-corporations.read_corporation_membership.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/roles/history/', scope: 'esi:esi-corporations.read_corporation_membership.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/shareholders/', scope: 'esi:esi-wallet.read_corporation_wallets.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/standings/', scope: 'esi:esi-corporations.read_standings.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/starbases/:starbase_id/', scope: 'esi:esi-corporations.read_starbases.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/starbases/', scope: 'esi:esi-corporations.read_starbases.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/structures/', scope: 'esi:esi-corporations.read_structures.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/titles/', scope: 'esi:esi-corporations.read_titles.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/wallets/:division/journal/', scope: 'esi:esi-wallet.read_corporation_wallets.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/wallets/:division/transactions/', scope: 'esi:esi-wallet.read_corporation_wallets.v1' },
	{ method: 'GET', template: '/:version/corporations/:corporation_id/wallets/', scope: 'esi:esi-wallet.read_corporation_wallets.v1' },
	{ method: 'GET', template: '/:version/fleets/:fleet_id/', scope: 'esi:esi-fleets.read_fleet.v1' },
	{ method: 'DELETE', template: '/:version/fleets/:fleet_id/members/:member_id/', scope: 'esi:esi-fleets.write_fleet.v1' },
	{ method: 'PUT', template: '/:version/fleets/:fleet_id/members/:member_id/', scope: 'esi:esi-fleets.write_fleet.v1' },
	{ method: 'GET', template: '/:version/fleets/:fleet_id/members/', scope: 'esi:esi-fleets.read_fleet.v1' },
	{ method: 'POST', template: '/:version/fleets/:fleet_id/members/', scope: 'esi:esi-fleets.write_fleet.v1' },
	{ method: 'PUT', template: '/:version/fleets/:fleet_id/', scope: 'esi:esi-fleets.write_fleet.v1' },
	{ method: 'DELETE', template: '/:version/fleets/:fleet_id/squads/:squad_id/', scope: 'esi:esi-fleets.write_fleet.v1' },
	{ method: 'PUT', template: '/:version/fleets/:fleet_id/squads/:squad_id/', scope: 'esi:esi-fleets.write_fleet.v1' },
	{ method: 'DELETE', template: '/:version/fleets/:fleet_id/wings/:wing_id/', scope: 'esi:esi-fleets.write_fleet.v1' },
	{ method: 'PUT', template: '/:version/fleets/:fleet_id/wings/:wing_id/', scope: 'esi:esi-fleets.write_fleet.v1' },
	{ method: 'POST', template: '/:version/fleets/:fleet_id/wings/:wing_id/squads/', scope: 'esi:esi-fleets.write_fleet.v1' },
	{ method: 'GET', template: '/:version/fleets/:fleet_id/wings/', scope: 'esi:esi-fleets.read_fleet.v1' },
	{ method: 'POST', template: '/:version/fleets/:fleet_id/wings/', scope: 'esi:esi-fleets.write_fleet.v1' },
	{ method: 'GET', template: '/:version/markets/structures/:structure_id/', scope: 'esi:esi-markets.structure_markets.v1' },
	{ method: 'POST', template: '/:version/ui/autopilot/waypoint/', scope: 'esi:esi-ui.write_waypoint.v1' },
	{ method: 'POST', template: '/:version/ui/openwindow/contract/', scope: 'esi:esi-ui.open_window.v1' },
	{ method: 'POST', template: '/:version/ui/openwindow/information/', scope: 'esi:esi-ui.open_window.v1' },
	{ method: 'POST', template: '/:version/ui/openwindow/marketdetails/', scope: 'esi:esi-ui.open_window.v1' },
	{ method: 'POST', template: '/:version/ui/openwindow/newmail/', scope: 'esi:esi-ui.open_window.v1' },
	{ method: 'GET', template: '/:version/universe/structures/:structure_id/', scope: 'esi:esi-universe.read_structures.v1' },
]

const ESI_SCOPE_ROUTERS = buildEsiScopeRouters()

function buildEsiScopeRouters(): Map<EsiRouteMethod, RadixRouter<EsiScopeRouteData>> {
	const routers = new Map<EsiRouteMethod, RadixRouter<EsiScopeRouteData>>()
	for (const route of ESI_SCOPE_ROUTES) {
		let router = routers.get(route.method)
		if (!router) {
			router = createRouter<EsiScopeRouteData>()
			routers.set(route.method, router)
		}
		router.insert(route.template, { scope: route.scope })
	}
	return routers
}

export function normalizeEsiProxyPath(inputPath: string): string {
	if (inputPath.startsWith('/latest/') || inputPath.startsWith('/dev/') || /^\/v\d+\//i.test(inputPath)) {
		return inputPath
	}
	return `/latest${inputPath.startsWith('/') ? inputPath : `/${inputPath}`}`
}

export function isReadMethod(method: string): boolean {
	const m = method.toUpperCase()
	return m === 'GET' || m === 'HEAD'
}

function routeMethodForRequest(method: string): EsiRouteMethod | null {
	const requestMethod = method.toUpperCase()
	if (requestMethod === 'HEAD') return 'GET'
	if (requestMethod === 'DELETE' || requestMethod === 'GET' || requestMethod === 'POST' || requestMethod === 'PUT') {
		return requestMethod
	}
	return null
}

function isSupportedEsiVersion(version: unknown): boolean {
	return typeof version === 'string' && (version === 'latest' || version === 'dev' || /^v\d+$/i.test(version))
}

function lookupEsiScopeRoute(method: string, path: string): MatchedRoute<EsiScopeRouteData> | null {
	const routeMethod = routeMethodForRequest(method)
	if (!routeMethod) return null
	const match = ESI_SCOPE_ROUTERS.get(routeMethod)?.lookup(path) ?? null
	if (!match || !isSupportedEsiVersion(match.params?.version)) return null
	return match
}

export function requiredScopeForEsiRequest(
	method: string,
	path: string
): ThirdPartyAppScope | null {
	return lookupEsiScopeRoute(method, path)?.scope ?? null
}

export function hasScope(scope: string | string[] | undefined, required: string): boolean {
	if (!scope) return false
	const values = Array.isArray(scope) ? scope : scope.split(/\s+/)
	const set = new Set(values.filter(Boolean))
	return set.has(required)
}

export function isAllowedWritePath(method: string, path: string): boolean {
	return !isReadMethod(method) && lookupEsiScopeRoute(method, path) !== null
}

export function extractCharacterIdFromEsiPath(path: string): string | null {
	const match = path.match(/^\/(?:latest|dev|v\d+)\/characters\/(\d+)(?:\/|$)/i)
	return match?.[1] ?? null
}
