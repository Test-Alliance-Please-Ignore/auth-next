import { parseBroadcastSrpMode } from '@repo/broadcasts'

import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { generateSrpTokenAtFormLoad } from '@/features/broadcasts/srp-token-generator'
import { useAppTranslation } from '@/i18n'

import type { BroadcastSrpMode } from '@repo/broadcasts'

interface SystemSrpFieldProps {
	fieldName: string
	value: string | undefined
	token: string | undefined
	onChange: (next: { mode: BroadcastSrpMode; token: string }) => void
}

export function SystemSrpField({ fieldName, value, token, onChange }: SystemSrpFieldProps) {
	const { t } = useAppTranslation()
	return (
		<div className="w-full space-y-2">
			<Label htmlFor={fieldName}>{t('broadcasts.composer.srp')}</Label>
			<Select
				inputId={fieldName}
				value={parseBroadcastSrpMode(value)}
				onValueChange={(nextValue) => {
					const mode = nextValue as BroadcastSrpMode
					if (mode === 'disabled') {
						onChange({ mode, token: '' })
						return
					}
					onChange({
						mode,
						token: (token ?? '').trim().length > 0 ? (token ?? '') : generateSrpTokenAtFormLoad(),
					})
				}}
				options={[
					{ value: 'blanket', label: t('broadcasts.composer.srpBlanket') },
					{ value: 'military', label: t('broadcasts.composer.srpMilitary') },
					{ value: 'coalition', label: t('broadcasts.composer.srpCoalition') },
					{ value: 'disabled', label: t('broadcasts.composer.srpDisabled') },
				]}
			/>
		</div>
	)
}
