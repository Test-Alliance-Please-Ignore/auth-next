import { useEffect, useRef, useState } from 'react'

import { useAppTranslation } from '@/i18n'

import type { AppTranslator } from '@/i18n'

export type MessageText = string | ((t: AppTranslator) => string)

type PendingMessage = Omit<Message, 'text'> & { text: MessageText }

export interface Message {
	type: 'success' | 'error'
	text: string
}

/**
 * Safe message hook that automatically cleans up timeouts on unmount
 * Prevents "Maximum update depth exceeded" errors from setTimeout state updates
 */
export function useMessage() {
	const { t } = useAppTranslation()
	const [message, setMessage] = useState<PendingMessage | null>(null)
	const timeoutRef = useRef<NodeJS.Timeout | null>(null)

	// Clear any existing timeout
	const clearCurrentTimeout = () => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current)
			timeoutRef.current = null
		}
	}

	// Set a message with automatic clearing after specified duration
	const showMessage = (newMessage: PendingMessage, duration = 5000) => {
		// Clear any existing timeout first
		clearCurrentTimeout()

		// Set the new message
		setMessage(newMessage)

		// Set timeout to clear the message
		if (duration > 0) {
			timeoutRef.current = setTimeout(() => {
				setMessage(null)
				timeoutRef.current = null
			}, duration)
		}
	}

	// Show success message with default 3 second duration
	const showSuccess = (text: MessageText, duration = 3000) => {
		showMessage({ type: 'success', text }, duration)
	}

	// Show error message with default 5 second duration
	const showError = (text: MessageText, duration = 5000) => {
		showMessage({ type: 'error', text }, duration)
	}

	// Clear message immediately
	const clearMessage = () => {
		clearCurrentTimeout()
		setMessage(null)
	}

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
		}
	}, [])

	return {
		message: message && {
			...message,
			text: typeof message.text === 'function' ? message.text(t) : message.text,
		},
		showMessage,
		showSuccess,
		showError,
		clearMessage,
	}
}
