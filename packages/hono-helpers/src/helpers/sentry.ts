import {
	captureException as sentryCaptureException,
	captureMessage as sentryCaptureMessage,
	instrumentDurableObjectWithSentry,
	withScope,
} from '@sentry/cloudflare'
import type { DurableObject, DurableObjectState } from 'cloudflare:workers'

/**
 * Capture an exception to Sentry with optional context
 */
export function captureException(
	error: Error,
	context?: {
		tags?: Record<string, string>
		extra?: Record<string, unknown>
		user?: { id: string }
		request?: {
			url: string
			method: string
			headers?: Record<string, string>
		}
	}
): void {
	withScope((scope) => {
		if (context?.tags) {
			Object.entries(context.tags).forEach(([key, value]) => {
				scope.setTag(key, value)
			})
		}

		if (context?.extra) {
			Object.entries(context.extra).forEach(([key, value]) => {
				scope.setExtra(key, value)
			})
		}

		if (context?.user) {
			scope.setUser(context.user)
		}

		if (context?.request) {
			scope.setContext('request', context.request)
		}

		sentryCaptureException(error)
	})
}

/**
 * Capture a message to Sentry
 */
export function captureMessage(
	message: string,
	level: 'info' | 'warning' | 'error' = 'info'
): void {
	sentryCaptureMessage(message, level)
}

/**
 * Create an instrumented Durable Object class with automatic Sentry error tracking
 *
 * This wrapper automatically captures unhandled exceptions in Durable Object methods
 * and sends them to Sentry with appropriate context.
 *
 * @example
 * ```typescript
 * import { createInstrumentedDurableObject } from '@repo/hono-helpers'
 * import { MyDurableObjectClass } from './durable-object'
 *
 * export const MyDurableObject = createInstrumentedDurableObject(MyDurableObjectClass)
 * ```
 *
 * @param DurableObjectClass - The Durable Object class to instrument
 * @returns Instrumented Durable Object class with Sentry error tracking
 */
export function createInstrumentedDurableObject<T extends DurableObject>(
	DurableObjectClass: new (state: DurableObjectState, env: any) => T
): new (state: DurableObjectState, env: any) => T {
	return instrumentDurableObjectWithSentry(DurableObjectClass)
}

// Re-export commonly used Sentry functions
export {
	withScope,
	captureException as sentryCaptureException,
	captureMessage as sentryCaptureMessage,
} from '@sentry/cloudflare'
