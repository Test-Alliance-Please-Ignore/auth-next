/**
 * Discord client utilities
 * Text formatting utilities for Discord markdown
 */

// Re-export DiscordFetch and DiscordRoutes
export {
	DiscordFetch,
	DiscordAPIError,
	DiscordRateLimitError,
	type DiscordFetchOptions,
	type DiscordProxyConfig,
} from './discord-fetch'
export { DiscordRoutes, type DiscordRoutesType } from './routes'

/**
 * Text formatting utilities for Discord markdown
 */

/** Format text as bold: **text** */
export const bold = (text: string): string => `**${text}**`

/** Format text as italic: *text* */
export const italic = (text: string): string => `*${text}*`

/** Format text as underline: __text__ */
export const underline = (text: string): string => `__${text}__`

/** Format text as strikethrough: ~~text~~ */
export const strikethrough = (text: string): string => `~~${text}~~`

/** Format text as spoiler: ||text|| */
export const spoiler = (text: string): string => `||${text}||`

/** Format text as quote: > text */
export const quote = (text: string): string => `> ${text}`

/** Format text as block quote: >>> text */
export const blockQuote = (text: string): string => `>>> ${text}`

/** Format text as subtext (small/muted): -# text */
export const subtext = (text: string): string => `-# ${text}`
