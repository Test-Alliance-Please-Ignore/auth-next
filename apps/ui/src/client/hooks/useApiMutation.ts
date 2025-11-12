/**
 * Wrapper around useMutation with automatic toast notifications
 */

import { useMutation } from '@tanstack/react-query'

import {
	AuthenticationError,
	AuthorizationError,
	NetworkError,
	NotFoundError,
	ServerError,
	ValidationError,
} from '../lib/api'
import toast from '../lib/toast'

import type { UseMutationOptions, UseMutationResult } from '@tanstack/react-query'

/**
 * Format error message for display
 * Extracts user-friendly message from various error types
 */
function formatErrorMessage(error: unknown): string {
	if (error instanceof ValidationError) {
		return error.message
	}

	if (error instanceof NetworkError) {
		return error.message
	}

	if (error instanceof AuthenticationError) {
		return error.message
	}

	if (error instanceof AuthorizationError) {
		return error.message
	}

	if (error instanceof NotFoundError) {
		return error.message
	}

	if (error instanceof ServerError) {
		return error.message
	}

	if (error instanceof Error) {
		return error.message
	}

	return 'Something went wrong. Please try again.'
}

/**
 * Options for useApiMutation hook
 */
export interface UseApiMutationOptions<TData = unknown, TVariables = void, TContext = unknown>
	extends Omit<
		UseMutationOptions<TData, Error, TVariables, TContext>,
		'mutationFn' | 'onSuccess' | 'onError'
	> {
	/**
	 * The mutation function to execute
	 */
	mutationFn: (variables: TVariables) => Promise<TData>

	/**
	 * Success callback (optional, can be used alongside successMessage)
	 */
	onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined) => void

	/**
	 * Error callback (optional, can be used alongside errorMessage)
	 */
	onError?: (error: Error, variables: TVariables, context: TContext | undefined) => void

	/**
	 * Success message to display in toast
	 * Can be a string or a function that receives the response data
	 */
	successMessage?: string | ((data: TData, variables: TVariables) => string)

	/**
	 * Error message to display in toast
	 * Can be a string or a function that receives the error
	 * If not provided, uses the error message from the backend
	 */
	errorMessage?: string | ((error: Error) => string)

	/**
	 * Whether to show success toast notification
	 * @default true
	 */
	showSuccessToast?: boolean

	/**
	 * Whether to show error toast notification
	 * @default true
	 */
	showErrorToast?: boolean
}

/**
 * Wrapper around useMutation that automatically handles errors with toasts
 *
 * @example
 * ```tsx
 * const createGroup = useApiMutation({
 *   mutationFn: (data: CreateGroupRequest) => api.createGroup(data),
 *   successMessage: (group) => `Group "${group.name}" created successfully`,
 *   onSuccess: (group) => {
 *     queryClient.invalidateQueries({ queryKey: ['groups'] })
 *     navigate(`/groups/${group.id}`)
 *   },
 * })
 * ```
 */
export function useApiMutation<TData = unknown, TVariables = void, TContext = unknown>(
	options: UseApiMutationOptions<TData, TVariables, TContext>
): UseMutationResult<TData, Error, TVariables, TContext> {
	const {
		mutationFn,
		successMessage,
		errorMessage,
		showSuccessToast = true,
		showErrorToast = true,
		onSuccess,
		onError,
		...mutationOptions
	} = options

	return useMutation<TData, Error, TVariables, TContext>({
		mutationFn,
		onSuccess: (data, variables, context) => {
			// Show success toast if enabled
			if (showSuccessToast && successMessage) {
				const message =
					typeof successMessage === 'function' ? successMessage(data, variables) : successMessage
				toast.success(message)
			}

			// Call user's onSuccess callback
			onSuccess?.(data, variables, context)
		},
		onError: (error, variables, context) => {
			// Show error toast if enabled
			if (showErrorToast) {
				const message = errorMessage
					? typeof errorMessage === 'function'
						? errorMessage(error)
						: errorMessage
					: formatErrorMessage(error)

				toast.error(message)
			}

			// Call user's onError callback
			onError?.(error, variables, context)
		},
		...mutationOptions,
	})
}
