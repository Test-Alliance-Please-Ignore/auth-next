const reinforcementDatePattern = /\b(\d{4})[.-](\d{2})[.-](\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\b/
const reinforcementEventPattern = /\b(reinforced|anchoring)\s+until\b/i
const parenthesizedSystemPattern = /^\s*(.*?)\s*\(\s*([A-Za-z0-9-]{2,})[^)]*\)/
const dashedSystemPattern =
	/^\s*([A-Za-z0-9-]+)\s*-\s*(.*?)(?:\s+\d[\d,]*\s*(?:km|m)\b|\s+Sec\.\s*[\d.]+|\s+(?:Reinforced|Anchoring)\s+until\b|$)/i

export interface ParsedTimerboardText {
	title: string | null
	systemName: string | null
	eventAt: string
	event: 'reinforced' | 'anchoring' | null
}

function normalize(value: string): string {
	return value.trim().replace(/\s+/g, ' ')
}

export function parseTimerboardText(value: string): ParsedTimerboardText | null {
	const text = normalize(value)
	if (!text) return null
	const date = text.match(reinforcementDatePattern)
	if (!date) return null

	const [, year, month, day, hour, minute, second = '00'] = date
	const parsedDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`)
	if (Number.isNaN(parsedDate.getTime())) return null
	if (
		parsedDate.getUTCFullYear() !== Number(year) ||
		parsedDate.getUTCMonth() + 1 !== Number(month) ||
		parsedDate.getUTCDate() !== Number(day) ||
		parsedDate.getUTCHours() !== Number(hour) ||
		parsedDate.getUTCMinutes() !== Number(minute) ||
		parsedDate.getUTCSeconds() !== Number(second)
	)
		return null

	const eventMatch = text.match(reinforcementEventPattern)
	const event = eventMatch ? (eventMatch[1].toLowerCase() as ParsedTimerboardText['event']) : null
	const parenthesized = text.match(parenthesizedSystemPattern)
	const dashed = text.match(dashedSystemPattern)
	const title = parenthesized?.[1] ?? dashed?.[2] ?? null
	const systemName = parenthesized?.[2] ?? dashed?.[1] ?? null

	return {
		title: title ? normalize(title) : null,
		systemName: systemName ? normalize(systemName) : null,
		eventAt: parsedDate.toISOString(),
		event,
	}
}
