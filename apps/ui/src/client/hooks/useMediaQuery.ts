import { useEffect, useState } from 'react'

/**
 * Custom hook for responsive breakpoint detection
 * @param query - CSS media query string (e.g., '(max-width: 768px)')
 * @returns boolean indicating if the media query matches
 */
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(false)

	useEffect(() => {
		const media = window.matchMedia(query)

		// Set initial value
		setMatches(media.matches)

		// Create listener function
		const listener = (e: MediaQueryListEvent) => {
			setMatches(e.matches)
		}

		// Add listener (handle both modern and legacy APIs)
		if (media.addEventListener) {
			media.addEventListener('change', listener)
		} else {
			// @ts-ignore - Legacy API fallback
			media.addListener(listener)
		}

		// Cleanup
		return () => {
			if (media.removeEventListener) {
				media.removeEventListener('change', listener)
			} else {
				// @ts-ignore - Legacy API fallback
				media.removeListener(listener)
			}
		}
	}, [query])

	return matches
}
