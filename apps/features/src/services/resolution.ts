/**
 * Pure feature-flag resolution rules.
 *
 * These helpers contain the precedence logic for turning a global flag value
 * plus an optional per-user override into an effective boolean. They are kept
 * free of any database or I/O so the (subtle) precedence rules can be unit
 * tested deterministically, without a live Postgres connection.
 */

/** The minimal flag shape needed to resolve an effective value. */
export interface ResolvableFlag {
	/** The flag's primary id (matches user_feature_flags.feature_flag_id). */
	id: string
	/** The flag's hierarchical key. */
	key: string
	/** The flag's global boolean value (null when the flag is non-boolean/unset). */
	booleanValue: boolean | null
}

/**
 * Resolve the effective enabled state for a single flag.
 *
 * Precedence: user override -> flag's global boolean value -> false.
 *
 * Uses nullish coalescing (not `||`) so that an override or global value of
 * `false` is respected — e.g. an override of `false` must win over a global
 * `true`, and a global `false` must win over a missing override.
 *
 * @param override - The user's override value, or undefined when none exists
 * @param globalValue - The flag's global boolean value, or null when unset
 * @returns The effective enabled state
 */
export function resolveFlagValue(
	override: boolean | undefined,
	globalValue: boolean | null
): boolean {
	return override ?? globalValue ?? false
}

/**
 * Resolve a batch of requested keys into a complete key -> boolean map.
 *
 * Every requested key is present in the result (so callers get a total map),
 * even keys that reference an unregistered flag, which resolve to `false`.
 * Duplicate keys collapse to a single entry.
 *
 * @param keys - The requested flag keys (may contain duplicates)
 * @param flags - The flags that were found for the requested keys
 * @param overrideByFlagId - Map of feature_flag_id -> the user's override value
 * @returns A map of every requested key to its effective enabled state
 */
export function resolveFlagValues(
	keys: string[],
	flags: readonly ResolvableFlag[],
	overrideByFlagId: ReadonlyMap<string, boolean>
): Record<string, boolean> {
	// Seed every requested key to false so unregistered flags default to off.
	const result: Record<string, boolean> = {}
	for (const key of keys) {
		result[key] = false
	}

	// Overlay the resolved value for each flag that actually exists.
	for (const flag of flags) {
		result[flag.key] = resolveFlagValue(overrideByFlagId.get(flag.id), flag.booleanValue)
	}

	return result
}
