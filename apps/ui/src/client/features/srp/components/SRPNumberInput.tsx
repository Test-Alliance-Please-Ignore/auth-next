import { NumberInput } from '@/components/ui/number-input'
import { useAppTranslation } from '@/i18n'

import type { ComponentProps } from 'react'

/** Localized display separators with canonical numeric values passed to the SRP API. */
export function SRPNumberInput(props: ComponentProps<typeof NumberInput>) {
	const { locale } = useAppTranslation()
	const parts = new Intl.NumberFormat(locale).formatToParts(1234.5)
	return (
		<NumberInput
			thousandSeparator={parts.find((part) => part.type === 'group')?.value ?? ''}
			decimalSeparator={parts.find((part) => part.type === 'decimal')?.value ?? '.'}
			{...props}
		/>
	)
}
