import { WorkersLogger, withLogTags } from 'workers-tagged-logger'

import type { LogLevel } from 'workers-tagged-logger'

export type LogTagHints = {
	// add common tags here so that they show up as hints
	// in `logger.setTags()` and `logger.withTags()`
	url: string
}

type ConsoleLike = {
	log: typeof console.log
	info: typeof console.info
	warn: typeof console.warn
	error: typeof console.error
	debug: typeof console.debug
}

type StructuredConsoleLog = {
	level?: string
	time?: string
	message?: unknown
	tags?: Record<string, unknown>
}

const CONSOLE_BRIDGE_KEY = Symbol.for('auth-next.hono-helpers.console-bridge')

function getLogLevelPriority(level: LogLevel): number {
	switch (level) {
		case 'debug':
			return 0
		case 'info':
		case 'log':
			return 1
		case 'warn':
			return 2
		case 'error':
			return 3
	}
}

export async function withWorkerLogLevelContext<T>(
	logLevel: LogLevel,
	callback: () => Promise<T> | T
): Promise<T> {
	return await withLogTags({ tags: { $logger: { level: logLevel } } }, async () => {
		return await callback()
	})
}

function isStructuredConsoleLog(value: unknown): value is StructuredConsoleLog {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false
	}

	const candidate = value as Record<string, unknown>
	return (
		typeof candidate.level === 'string' &&
		typeof candidate.time === 'string' &&
		('message' in candidate || 'tags' in candidate)
	)
}

function stringifyMessage(msg: unknown): string {
	if (msg === undefined || msg === null) {
		return `${msg}`
	}

	if (typeof msg === 'string') {
		return msg
	}

	if (typeof msg === 'number' || typeof msg === 'boolean') {
		return msg.toString()
	}

	if (typeof msg === 'function') {
		return `[function${msg.name ? `: ${msg.name}` : ''}()]`
	}

	if (msg instanceof Error) {
		return `${msg.name}: ${msg.message}${msg.stack !== undefined ? `\n${msg.stack}` : ''}`
	}

	try {
		return JSON.stringify(msg)
	} catch {
		return '[unserializable object]'
	}
}

function stringifyMessages(...msgs: unknown[]): string {
	return msgs.map(stringifyMessage).join(' ')
}

function buildStructuredConsoleLog(level: LogLevel, msgs: unknown[]): Record<string, unknown> | null {
	const tags = logger.getTags()
	const levelTag =
		typeof tags.$logger === 'object' &&
		tags.$logger !== null &&
		!Array.isArray(tags.$logger) &&
		typeof (tags.$logger as Record<string, unknown>).level === 'string'
			? ((tags.$logger as Record<string, unknown>).level as LogLevel)
			: undefined
	const minimumLogLevel = levelTag ?? 'warn'

	if (getLogLevelPriority(level) < getLogLevelPriority(minimumLogLevel)) {
		return null
	}

	const enhancedTags: Record<string, unknown> = { ...tags }
	const existingLogger = enhancedTags.$logger
	const loggerObject =
		existingLogger &&
		typeof existingLogger === 'object' &&
		!Array.isArray(existingLogger) &&
		!(existingLogger instanceof Date)
			? { ...(existingLogger as Record<string, unknown>) }
		: {}

	if (minimumLogLevel !== 'warn') {
		loggerObject.level = minimumLogLevel
	}

	if (Object.keys(loggerObject).length > 0) {
		enhancedTags.$logger = loggerObject
	}

	const message =
		msgs.length === 0
			? undefined
			: msgs.length === 1
				? stringifyMessage(msgs[0])
				: stringifyMessages(...msgs)

	const log: Record<string, unknown> = {
		message,
		level,
		time: new Date().toISOString(),
	}

	if (Object.keys(enhancedTags).length > 0) {
		log.tags = enhancedTags
	}

	return log
}

function installConsoleBridge(): void {
	const globalConsole = globalThis as typeof globalThis & {
		[CONSOLE_BRIDGE_KEY]?: ConsoleLike
	}

	if (globalConsole[CONSOLE_BRIDGE_KEY] !== undefined) {
		return
	}

	const originalConsole: ConsoleLike = {
		log: console.log.bind(console),
		info: console.info.bind(console),
		warn: console.warn.bind(console),
		error: console.error.bind(console),
		debug: console.debug.bind(console),
	}

	globalConsole[CONSOLE_BRIDGE_KEY] = originalConsole

	const bridge = (level: LogLevel) => {
		return (...msgs: unknown[]) => {
			if (msgs.length === 1 && isStructuredConsoleLog(msgs[0])) {
				originalConsole.log(msgs[0])
				return
			}

			const structuredLog = buildStructuredConsoleLog(level, msgs)
			if (structuredLog === null) {
				return
			}

			originalConsole.log(structuredLog)
		}
	}

	console.log = bridge('log')
	console.info = bridge('info')
	console.warn = bridge('warn')
	console.error = bridge('error')
	console.debug = bridge('debug')
}

export function resolveLogLevel(
	value: string | undefined | null,
	fallback: LogLevel = 'warn'
): LogLevel {
	if (!value) {
		return fallback
	}

	const normalized = value.trim().toLowerCase()
	if (
		normalized === 'debug' ||
		normalized === 'info' ||
		normalized === 'log' ||
		normalized === 'warn' ||
		normalized === 'error'
	) {
		return normalized
	}

	return fallback
}

export const logger = new WorkersLogger<LogTagHints>({
	minimumLogLevel: 'warn',
})

installConsoleBridge()
