export interface ProfileNavigationState {
	source?: 'applications' | 'members'
	returnTo?: string
	corporationId?: string
}

/**
 * Recover application context for a profile opened in a new tab.
 * React Router state is not transferred to a new browsing context, but the
 * browser normally sends the same-origin application URL as the referrer.
 */
export function getApplicationProfileNavigationFromReferrer(): ProfileNavigationState | null {
	if (typeof window === 'undefined' || typeof document === 'undefined' || !document.referrer) {
		return null
	}

	try {
		const referrer = new URL(document.referrer)
		if (referrer.origin !== window.location.origin) return null

		const match = /^\/corporations\/([^/]+)\/applications\/([^/]+)\/?$/.exec(referrer.pathname)
		if (!match) return null

		return {
			source: 'applications',
			returnTo: `${referrer.pathname}${referrer.search}${referrer.hash}`,
			corporationId: match[1],
		}
	} catch {
		return null
	}
}
