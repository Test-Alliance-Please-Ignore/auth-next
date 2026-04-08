import { commandResponse } from './types'

import type { ProgrammaticCommandDefinition } from './types'

function pad2(value: number): string {
	return value.toString().padStart(2, '0')
}

function formatEveTime(now: Date): string {
	const monthNames = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December',
	]
	const year = now.getUTCFullYear()
	const month = monthNames[now.getUTCMonth()] ?? 'Unknown'
	const day = pad2(now.getUTCDate())
	const hours = pad2(now.getUTCHours())
	const minutes = pad2(now.getUTCMinutes())
	return `${month} ${day}, ${year} at ${hours}:${minutes}`
}

export const EVETIME_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'evetime',
	description: 'Show the current EVE time (UTC).',
	handler: () => {
		const now = new Date()
		const timestampSeconds = Math.floor(now.getTime() / 1000)
		return commandResponse(
			`Current EVE Time: ${formatEveTime(now)}\nYour local time: <t:${timestampSeconds}:f>`
		)
	},
}
