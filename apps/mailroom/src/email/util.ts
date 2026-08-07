import { logger } from '@repo/hono-helpers'

import type { EmailLogger } from './types'

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === 'string') return error
	try {
		return JSON.stringify(error)
	} catch (error) {
		return String(error)
	}
}

/** Default console-backed logger used when no logger is injected into the handler. */
export const consoleLogger: EmailLogger = {
	info: (message, data) => logger.log(format('info', message, data)),
	warn: (message, data) => logger.warn(format('warn', message, data)),
	error: (message, data) => logger.error(format('error', message, data)),
}

function format(level: string, message: string, data?: Record<string, unknown>): string {
	const line = `[email:${level}] ${message}`
	if (!data || Object.keys(data).length === 0) return line
	try {
		return `${line} ${JSON.stringify(data)}`
	} catch {
		return line
	}
}
