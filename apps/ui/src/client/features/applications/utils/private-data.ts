import { i18n } from '@/i18n'

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
	return isForbiddenError(error)
		? i18n.t('common.privateData.forbidden')
		: i18n.t('common.privateData.unavailable')
}
