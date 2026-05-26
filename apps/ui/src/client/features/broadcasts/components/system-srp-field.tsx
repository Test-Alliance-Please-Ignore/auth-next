import { parseBroadcastSrpMode } from '@repo/broadcasts'

import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { generateSrpTokenAtFormLoad } from '@/features/broadcasts/srp-token-generator'

import type { BroadcastSrpMode } from '@repo/broadcasts'

interface SystemSrpFieldProps {
	fieldName: string
	value: string | undefined
	token: string | undefined
	onChange: (next: { mode: BroadcastSrpMode; token: string }) => void
}

export function SystemSrpField({ fieldName, value, token, onChange }: SystemSrpFieldProps) {
	return (
		<div className="w-full space-y-2">
			<Label htmlFor={fieldName}>SRP Type</Label>
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
					{ value: 'blanket', label: 'Blanket SRP' },
					{ value: 'military', label: 'Military SRP' },
					{ value: 'coalition', label: 'Coalition SRP' },
					{ value: 'disabled', label: 'No SRP' },
				]}
			/>
		</div>
	)
}
