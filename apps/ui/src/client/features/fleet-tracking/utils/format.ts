import { i18n } from '@/i18n'
import {
	formatDurationBetween as formatDurationBetweenShared,
	formatDurationMs,
} from '@/lib/duration-utils'

/**
 * Format a duration in milliseconds as a short human-readable string.
 * Examples: "12s", "4m 30s", "1h 23m", "2d 4h".
 */
export function formatDuration(ms: number): string {
	return formatDurationMs(ms, { maxUnits: 2, style: 'short' })
}

/**
 * Format a duration between two ISO timestamps; uses "now" if endIso is null.
 */
export function formatDurationBetween(startIso: string, endIso: string | null): string {
	return formatDurationBetweenShared(startIso, endIso, { maxUnits: 2, style: 'short' })
}

/**
 * Pretty-print an end reason for display.
 */
export function formatEndReason(reason: string | null): string {
	if (!reason) return i18n.t('fleetTracking.unknown')
	switch (reason) {
		case 'user_stopped':
			return i18n.t('fleetTracking.stoppedByUser')
		case 'admin_stopped':
			return i18n.t('fleetTracking.stoppedByAdmin')
		case 'fleet_disbanded':
			return i18n.t('fleetTracking.fleetDisbanded')
		case 'character_left_fleet':
			return i18n.t('fleetTracking.characterLeftFleet')
		case 'not_fleet_boss':
			return i18n.t('fleetTracking.characterNoLongerFleetBoss')
		case 'esi_error':
			return i18n.t('fleetTracking.esiError')
		case 'token_expired':
			return i18n.t('fleetTracking.tokenExpired')
		default:
			return reason
	}
}
