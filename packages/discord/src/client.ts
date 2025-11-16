import { REST, Routes } from 'discord.js'

export const createDiscordClient = (token: string, version: string = '12'): REST => {
	const rest = new REST({ version: version }).setToken(token)
	return rest
}

export { REST, Routes }

export {
	blockQuote,
	bold,
	italic,
	quote,
	spoiler,
	strikethrough,
	underline,
	subtext,
} from 'discord.js'
