import { useId } from 'react'

import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
	APP_LOCALES,
	localeNativeNames,
	parseAppLocale,
	setAppLocale,
	useAppTranslation,
} from '@/i18n'

const localeOptions = APP_LOCALES.map((locale) => ({
	value: locale,
	label: localeNativeNames[locale],
}))

export function LocalePicker() {
	const inputId = useId()
	const { locale, t } = useAppTranslation()

	return (
		<div className="space-y-2">
			<Label htmlFor={inputId} className="text-xs text-muted-foreground">
				{t('locale.label')}
			</Label>
			<Select
				inputId={inputId}
				options={localeOptions}
				value={locale}
				onValueChange={(value) => {
					const nextLocale = parseAppLocale(value)
					if (nextLocale) {
						void setAppLocale(nextLocale)
					}
				}}
				renderOption={(option) => <span lang={option.value}>{option.label}</span>}
			/>
		</div>
	)
}
