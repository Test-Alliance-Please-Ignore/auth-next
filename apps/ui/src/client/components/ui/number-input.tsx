import { NumberInput as MantineNumberInput } from '@mantine/core'

import {
	MANTINE_THEMED_NUMBER_INPUT_CLASS_NAMES,
	MANTINE_THEMED_NUMBER_INPUT_STYLES,
} from '@/lib/mantine-input-styles'

import type { NumberInputProps as MantineNumberInputProps } from '@mantine/core'

type NumberInputProps = Omit<MantineNumberInputProps, 'onChange' | 'classNames' | 'styles'> & {
	/** Called with the raw string value on change (empty string when cleared) */
	onChange?: (value: string) => void
	/** Applies destructive border styling when true */
	error?: boolean
}

export function NumberInput({ onChange, error, value, ...props }: NumberInputProps) {
	const numericValue = value === '' || value === undefined ? '' : Number(value)

	return (
		<MantineNumberInput
			thousandSeparator=","
			value={numericValue}
			classNames={{
				...MANTINE_THEMED_NUMBER_INPUT_CLASS_NAMES,
				wrapper: error
					? `${MANTINE_THEMED_NUMBER_INPUT_CLASS_NAMES.wrapper} !border-destructive`
					: MANTINE_THEMED_NUMBER_INPUT_CLASS_NAMES.wrapper,
			}}
			styles={MANTINE_THEMED_NUMBER_INPUT_STYLES}
			onChange={(val) => onChange?.(val === '' ? '' : String(val))}
			{...props}
		/>
	)
}
