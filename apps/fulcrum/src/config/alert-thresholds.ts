/**
 * Shared threshold constants for Fulcrum alert detection rules.
 * Centralised here so all values are reviewable and adjustable in one place.
 */
export const ALERT_THRESHOLDS = {
	/** Number of recent player corps to inspect for short stays */
	CORP_HOPPER_MAX_CORPS_TO_CHECK: 5,
	/** Minimum number of player corps required to trigger the alert */
	CORP_HOPPER_MIN_PLAYER_CORPS: 2,
	/** A corp stay shorter than this (days) counts as a "short stay" */
	CORP_HOPPER_WINDOW_DAYS: 30,

	/** Largest single ISK transfer thresholds */
	ISK_TRANSFER_NOTABLE: 500_000_000,
	ISK_TRANSFER_LARGE: 2_000_000_000,
	ISK_TRANSFER_VERY_LARGE: 10_000_000_000,
	ISK_TRANSFER_EXTREME: 50_000_000_000,

	/** Base training rate without implants (SP per hour) */
	SP_RATE_MAX_PER_HOUR: 2_700,
	/** Bonus SP budget for tutorials, events, free unallocated SP */
	SP_BONUS_THRESHOLD: 2_750_000,
	/** SP multiplier above max plausible that triggers a high-severity alert */
	SP_HIGH_MULTIPLIER: 1.10,
	/** SP multiplier above max plausible that triggers a critical-severity alert */
	SP_CRITICAL_MULTIPLIER: 1.25,
} as const
