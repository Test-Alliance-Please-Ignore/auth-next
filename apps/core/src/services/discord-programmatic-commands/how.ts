import { DISCORD_SLASH_COMMAND_OPTION_TYPE } from '@repo/discord'

import { commandResponse } from './types'

import type { ProgrammaticCommandDefinition } from './types'

function randomPercent(): string {
	const bytes = new Uint32Array(1)
	crypto.getRandomValues(bytes)
	const basisPoints = bytes[0] % 10_001
	return (basisPoints / 100).toFixed(2)
}

export const HOW_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'how',
	description: 'Rate how much one thing is another in percent.',
	options: [
		{
			type: DISCORD_SLASH_COMMAND_OPTION_TYPE.STRING,
			name: 'adjective',
			description: 'Descriptor to use in the result.',
			required: true,
			max_length: 50,
		},
		{
			type: DISCORD_SLASH_COMMAND_OPTION_TYPE.STRING,
			name: 'subject',
			description: 'Thing to rate.',
			required: true,
			max_length: 100,
		},
	],
	optionAliases: [
		{ path: 'subject', alias: 'thing' },
		{ path: 'subject', alias: 'otherThing' },
	],
	handler: ({ optionValues }) => {
		const adjective = optionValues.adjective?.trim() || 'interesting'
		const subject = optionValues.subject?.trim() || 'It'
		return commandResponse(`${subject} is ${randomPercent()}% ${adjective}`)
	},
}
