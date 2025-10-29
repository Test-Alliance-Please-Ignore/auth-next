/**
 * Timestamp conversion utilities for Discord broadcasts
 *
 * Automatically converts UNIX timestamps to Discord's timestamp format
 */

/**
 * Minimum valid timestamp (Jan 1, 2000)
 */
const MIN_TIMESTAMP = 946684800

/**
 * Maximum valid timestamp (Jan 1, 2100)
 */
const MAX_TIMESTAMP = 4102444800

/**
 * Regex pattern to match standalone numeric timestamps (10 or 13 digits)
 * Uses negative lookbehind/lookahead to avoid matching partial numbers
 */
const TIMESTAMP_PATTERN = /(?<!\d)(\d{10}|\d{13})(?!\d)/g

/**
 * Pattern to detect if a timestamp is already wrapped in Discord format
 */
const DISCORD_TIMESTAMP_PATTERN = /<t:\d+:[fFtTdDR]>/

/**
 * Validate if a number is a reasonable UNIX timestamp
 * @param timestamp - Timestamp in seconds
 * @returns True if timestamp is between 2000-2100
 */
function isValidTimestamp(timestamp: number): boolean {
	return timestamp >= MIN_TIMESTAMP && timestamp <= MAX_TIMESTAMP
}

/**
 * Convert UNIX timestamps in a message to Discord timestamp format
 *
 * This function scans the entire message for numeric timestamps (10 or 13 digits)
 * and converts them to Discord's timestamp format: `<t:timestamp:f>`
 *
 * Features:
 * - Supports both second timestamps (10 digits) and millisecond timestamps (13 digits)
 * - Validates timestamps are in a reasonable date range (2000-2100)
 * - Skips timestamps already in Discord format
 * - Only converts standalone numbers (not part of longer numbers)
 *
 * @param message - The message text to process
 * @param format - Discord timestamp format (default: 'f' for short date/time)
 * @returns Message with UNIX timestamps converted to Discord format
 *
 * @example
 * ```typescript
 * convertUnixTimestamps("Event at 1543392060")
 * // Returns: "Event at <t:1543392060:f>"
 *
 * convertUnixTimestamps("Meeting at 1543392060000")
 * // Returns: "Meeting at <t:1543392060:f>"
 *
 * convertUnixTimestamps("Already formatted: <t:1543392060:f>")
 * // Returns: "Already formatted: <t:1543392060:f>" (unchanged)
 * ```
 */
export function convertUnixTimestamps(message: string, format: string = 'f'): string {
	// Quick check: if message is already using Discord timestamp format, return as-is
	// This is a performance optimization for common cases
	if (DISCORD_TIMESTAMP_PATTERN.test(message)) {
		// Still process in case there are non-formatted timestamps alongside formatted ones
	}

	// Replace all matching timestamps
	return message.replace(TIMESTAMP_PATTERN, (match) => {
		const num = parseInt(match, 10)

		// Convert milliseconds to seconds if needed (13 digits -> 10 digits)
		const timestamp = match.length === 13 ? Math.floor(num / 1000) : num

		// Validate the timestamp is in a reasonable range
		if (!isValidTimestamp(timestamp)) {
			// Return original if not a valid timestamp
			return match
		}

		// Check if this timestamp is already wrapped in Discord format
		// Look at the characters immediately before and after
		const beforeMatch = message.substring(
			Math.max(0, message.indexOf(match) - 3),
			message.indexOf(match),
		)
		const afterMatch = message.substring(
			message.indexOf(match) + match.length,
			message.indexOf(match) + match.length + 3,
		)

		if (beforeMatch.includes('<t:') || afterMatch.startsWith(':')) {
			// Already in Discord format, don't convert
			return match
		}

		// Convert to Discord timestamp format
		return `<t:${timestamp}:${format}>`
	})
}
