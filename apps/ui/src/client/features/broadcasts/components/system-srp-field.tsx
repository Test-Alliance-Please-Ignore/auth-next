import { parseBroadcastSrpMode } from '@repo/broadcasts'

import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

import type { BroadcastSrpMode } from '@repo/broadcasts'

interface SystemSrpFieldProps {
	fieldName: string
	value: string | undefined
	onModeChange: (mode: BroadcastSrpMode) => void
}

export function SystemSrpField({ fieldName, value, onModeChange }: SystemSrpFieldProps) {
	return (
		<div className="w-full space-y-2">
			<Label htmlFor={fieldName}>SRP Type</Label>
			<Select
				inputId={fieldName}
				value={parseBroadcastSrpMode(value)}
				onValueChange={(nextValue) => onModeChange(nextValue as BroadcastSrpMode)}
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
