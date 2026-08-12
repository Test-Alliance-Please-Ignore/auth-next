export function shouldUseFullPageAuthRedirect(destination: string): boolean {
	if (destination.startsWith('/invite/') || destination.startsWith('/login')) {
		return true
	}

	try {
		const url = new URL(destination)
		return url.protocol === 'http:' || url.protocol === 'https:'
	} catch {
		return false
	}
}
