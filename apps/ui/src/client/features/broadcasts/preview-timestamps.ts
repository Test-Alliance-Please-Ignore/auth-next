/** Convert bare epochs for the Discord preview without wrapping existing tokens again.
 * Keep token markup canonical: only the renderer localizes its displayed date/time.
 */
export function convertUnixTimestampsForPreview(message: string): string {
	const timestampPattern = /<t:\d+(?::[tTdDfFR])?>|(?<!\d)(\d{10}|\d{13})(?!\d)/g
	return message.replace(timestampPattern, (match, bareTimestamp: string | undefined) => {
		if (!bareTimestamp) return match
		const numeric = Number.parseInt(bareTimestamp, 10)
		const timestamp = bareTimestamp.length === 13 ? Math.floor(numeric / 1000) : numeric
		if (timestamp < 946684800 || timestamp > 4102444800) return match
		return `<t:${timestamp}:f>`
	})
}
