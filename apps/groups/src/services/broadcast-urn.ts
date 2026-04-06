const BROADCAST_SEGMENT_PATTERN = /^[a-z0-9_-]+$/

export function validateBroadcastPermissionUrn(urn: string): string | null {
	if (!urn.startsWith('urn:broadcasts:')) {
		return null
	}

	const parts = urn.split(':')
	if (parts.length !== 5) {
		return 'Broadcast permission URN must be: urn:broadcasts:<entity-namespace>:<target-name>:<action>'
	}

	const entityNamespace = parts[2]
	const targetName = parts[3]
	const action = parts[4]

	if (!BROADCAST_SEGMENT_PATTERN.test(entityNamespace)) {
		return 'Broadcast entity namespace must match ^[a-z0-9_-]+$ (no spaces)'
	}

	if (!BROADCAST_SEGMENT_PATTERN.test(targetName)) {
		return 'Broadcast target name must match ^[a-z0-9_-]+$ (no spaces)'
	}

	if (action !== 'send' && action !== 'manage') {
		return 'Broadcast action must be either :send or :manage'
	}

	return null
}

export function assertValidBroadcastPermissionUrn(urn: string): void {
	const error = validateBroadcastPermissionUrn(urn)
	if (error) {
		throw new Error(error)
	}
}
