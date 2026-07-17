const FORBIDDEN_PRIVATE_DATA_MESSAGE =
	'Private ESI data is hidden because this user does not have an open application or shared corporation access for this character.'

const GENERIC_PRIVATE_DATA_MESSAGE = 'Private ESI data is unavailable right now.'

function isForbiddenError(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === 'object' &&
			'status' in error &&
			(error as { status?: number }).status === 403
	)
}

export function getPrivateDataUnavailableMessage(error: unknown): string | null {
	if (!error) return null
	return isForbiddenError(error) ? FORBIDDEN_PRIVATE_DATA_MESSAGE : GENERIC_PRIVATE_DATA_MESSAGE
}
