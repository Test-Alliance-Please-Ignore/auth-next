import { describe, expect, it } from 'vitest'

import {
	extractCharacterIdFromEsiPath,
	hasScope,
	isAllowedWritePath,
	isReadMethod,
	normalizeEsiProxyPath,
	requiredScopeForEsiRequest,
} from './proxy-policy'

describe('proxy-policy', () => {
	it('normalizes ESI paths to /latest when no version prefix is present', () => {
		expect(normalizeEsiProxyPath('/characters/123/location')).toBe('/latest/characters/123/location')
		expect(normalizeEsiProxyPath('characters/123/location')).toBe('/latest/characters/123/location')
	})

	it('preserves versioned ESI paths', () => {
		expect(normalizeEsiProxyPath('/latest/characters/123/location')).toBe('/latest/characters/123/location')
		expect(normalizeEsiProxyPath('/v5/characters/123/location')).toBe('/v5/characters/123/location')
		expect(normalizeEsiProxyPath('/dev/characters/123/location')).toBe('/dev/characters/123/location')
	})

	it('classifies read/write methods and route-specific required scope', () => {
		expect(isReadMethod('GET')).toBe(true)
		expect(isReadMethod('HEAD')).toBe(true)
		expect(isReadMethod('POST')).toBe(false)
		expect(requiredScopeForEsiRequest('GET', '/latest/characters/123/mail/')).toBe('esi:esi-mail.read_mail.v1')
		expect(requiredScopeForEsiRequest('POST', '/latest/ui/autopilot/waypoint/')).toBe('esi:esi-ui.write_waypoint.v1')
		expect(requiredScopeForEsiRequest('POST', '/latest/characters/123/assets/names/')).toBe('esi:esi-assets.read_assets.v1')
		expect(requiredScopeForEsiRequest('PUT', '/latest/fleets/42/members/99/')).toBe('esi:esi-fleets.write_fleet.v1')
		expect(requiredScopeForEsiRequest('GET', '/latest/universe/structures/1024/')).toBe('esi:esi-universe.read_structures.v1')
		expect(requiredScopeForEsiRequest('GET', '/latest/universe/systems/30000142/')).toBeNull()
		expect(requiredScopeForEsiRequest('HEAD', '/latest/characters/123/mail/')).toBe('esi:esi-mail.read_mail.v1')
		expect(requiredScopeForEsiRequest('GET', '/legacy/characters/123/mail/')).toBeNull()
	})

	it('checks space-delimited scopes', () => {
		expect(hasScope('profile esi:esi-mail.read_mail.v1', 'esi:esi-mail.read_mail.v1')).toBe(true)
		expect(hasScope('profile esi:esi-mail.read_mail.v1', 'esi:esi-ui.write_waypoint.v1')).toBe(false)
		expect(hasScope(undefined, 'esi:esi-mail.read_mail.v1')).toBe(false)
	})

	it('allowlists authenticated write endpoints only', () => {
		expect(isAllowedWritePath('POST', '/latest/ui/autopilot/waypoint/')).toBe(true)
		expect(isAllowedWritePath('POST', '/v2/ui/autopilot/waypoint')).toBe(true)
		expect(isAllowedWritePath('POST', '/latest/characters/123/fittings/')).toBe(true)
		expect(isAllowedWritePath('DELETE', '/latest/characters/123/mail/labels/456/')).toBe(true)
		expect(isAllowedWritePath('POST', '/latest/characters/123/location/')).toBe(false)
		expect(isAllowedWritePath('GET', '/latest/characters/123/fittings/')).toBe(false)
	})

	it('extracts character id from character-scoped paths', () => {
		expect(extractCharacterIdFromEsiPath('/latest/characters/2123/location/')).toBe('2123')
		expect(extractCharacterIdFromEsiPath('/v5/characters/99999/ship')).toBe('99999')
		expect(extractCharacterIdFromEsiPath('/latest/universe/systems/30000142/')).toBeNull()
	})
})
