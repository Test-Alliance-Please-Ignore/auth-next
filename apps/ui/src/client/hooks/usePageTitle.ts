import { useEffect } from 'react'

import { useAppTranslation } from '@/i18n'

const APP_NAME = 'Test Auth'

export function usePageTitle(title: string) {
	const { locale } = useAppTranslation()

	useEffect(() => {
		document.title = title ? `${title} | ${APP_NAME}` : APP_NAME
	}, [locale, title])
}
