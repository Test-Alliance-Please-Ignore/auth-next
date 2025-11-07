/**
 * Toast notification utilities using Sonner
 * Configured with EVE Online theme styling
 */

import { toast as sonnerToast } from 'sonner'
import type { ExternalToast } from 'sonner'

/**
 * Base toast configuration for EVE theme
 */
const baseToastOptions: ExternalToast = {
	duration: 4000, // 4 seconds default
	closeButton: true,
}

/**
 * Show a success toast notification
 * Auto-dismisses after 3 seconds
 */
export function success(message: string, options?: ExternalToast) {
	return sonnerToast.success(message, {
		...baseToastOptions,
		duration: 3000, // Shorter for success
		...options,
	})
}

/**
 * Show an error toast notification
 * Longer duration (5 seconds) to give users time to read
 */
export function error(message: string, options?: ExternalToast) {
	return sonnerToast.error(message, {
		...baseToastOptions,
		duration: 5000, // Longer for errors
		...options,
	})
}

/**
 * Show a warning toast notification
 * Requires manual dismissal by default
 */
export function warning(message: string, options?: ExternalToast) {
	return sonnerToast.warning(message, {
		...baseToastOptions,
		duration: Number.POSITIVE_INFINITY, // Manual dismiss
		...options,
	})
}

/**
 * Show an info toast notification
 */
export function info(message: string, options?: ExternalToast) {
	return sonnerToast.info(message, {
		...baseToastOptions,
		...options,
	})
}

/**
 * Show a loading toast notification
 * Returns the toast ID which can be used to update/dismiss it
 */
export function loading(message: string, options?: ExternalToast) {
	return sonnerToast.loading(message, {
		...baseToastOptions,
		duration: Number.POSITIVE_INFINITY, // Manual dismiss
		...options,
	})
}

/**
 * Show a promise-based toast notification
 * Automatically shows loading/success/error states
 */
export function promise<T>(
	promise: Promise<T>,
	options: {
		loading: string
		success: string | ((data: T) => string)
		error: string | ((error: unknown) => string)
	}
) {
	return sonnerToast.promise(promise, {
		loading: options.loading,
		success: options.success,
		error: options.error,
	})
}

/**
 * Dismiss a specific toast by ID
 */
export function dismiss(toastId?: string | number) {
	return sonnerToast.dismiss(toastId)
}

/**
 * Dismiss all toasts
 */
export function dismissAll() {
	return sonnerToast.dismiss()
}

/**
 * Centralized toast object with all methods
 */
const toast = {
	success,
	error,
	warning,
	info,
	loading,
	promise,
	dismiss,
	dismissAll,
}

export default toast
