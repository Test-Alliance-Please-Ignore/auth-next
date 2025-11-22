import {
	captureException as sentryCaptureException,
	captureMessage as sentryCaptureMessage,
	withScope,
} from '@sentry/cloudflare'

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

// Re-export commonly used Sentry functions
export {
	withScope,
	captureException as sentryCaptureException,
	captureMessage as sentryCaptureMessage,
} from '@sentry/cloudflare'
