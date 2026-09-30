import { useEffect, useRef } from 'react'

import { apiClient } from '../lib/api'
import { getFingerprint } from '../lib/fingerprint'

const STORAGE_KEY = 'ss_last'
const MIN_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const INITIAL_SYNC_DELAY_MS = 1000

export function useSessionSync(isAuthenticated: boolean): void {
	const sentRef = useRef(false)

	useEffect(() => {
		if (!isAuthenticated || sentRef.current) return

		const lastSent = sessionStorage.getItem(STORAGE_KEY)
		const now = Date.now()

		if (lastSent && now - parseInt(lastSent, 10) < MIN_INTERVAL_MS) {
			return // Throttled
		}

		sentRef.current = true

		let started = false
		const timeout = window.setTimeout(() => {
			started = true
			getFingerprint()
				.then((sid) => apiClient.post('/session/sync', { sid }))
				.then(() => {
					sessionStorage.setItem(STORAGE_KEY, now.toString())
				})
				.catch((err) => {
					console.warn('Session sync failed:', err)
					sentRef.current = false // Allow retry
				})
		}, INITIAL_SYNC_DELAY_MS)

		return () => {
			window.clearTimeout(timeout)
			if (!started) sentRef.current = false
		}
	}, [isAuthenticated])
}
