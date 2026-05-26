import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface SystemFleetTrackingFieldProps {
	enabled: boolean
	onEnabledChange: (enabled: boolean) => void
	disabled?: boolean
	disabledReason?: string
}

function isSwitchControlClick(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false
	return Boolean(target.closest('label,button,[role="switch"]'))
}

function toggleSwitchById(id: string): void {
	const element = document.getElementById(id)
	if (element instanceof HTMLButtonElement) {
		element.click()
	}
}

/**
 * Special template field that lets the broadcast author trigger fleet tracking
 * when the broadcast is sent. Mirrors the system_frogsiren pattern: a switch
 * that toggles a side effect at send time. When enabled, the author also picks
 * which of their characters to track (must be fleet boss at send time).
 */
export function SystemFleetTrackingField({
	enabled,
	onEnabledChange,
	disabled = false,
	disabledReason,
}: SystemFleetTrackingFieldProps) {
	const switchId = 'fleet-tracking-toggle'

	return (
		<div className="max-w-xl space-y-2">
			<div
				className={`flex items-center justify-between rounded-md border px-3 py-2 transition-colors ${
					disabled
						? 'border-border/60 bg-muted/40 cursor-not-allowed opacity-75'
						: 'border-border/60 cursor-pointer'
				} ${
					enabled ? 'bg-slate-500/15' : 'bg-transparent'
				}`}
				onClick={(event) => {
					if (disabled) return
					if (isSwitchControlClick(event.target)) return
					toggleSwitchById(switchId)
				}}
			>
				<Label
					htmlFor={switchId}
					className={`font-medium ${disabled ? 'cursor-not-allowed text-muted-foreground italic' : 'cursor-pointer'}`}
				>
					Start fleet tracking when broadcast is sent
				</Label>
				<Switch
					id={switchId}
					checked={enabled}
				disabled={disabled}
				onClick={(event) => event.stopPropagation()}
				onCheckedChange={onEnabledChange}
				/>
			</div>
			{disabledReason ? (
				<p className="text-xs text-muted-foreground italic">{disabledReason}</p>
			) : null}
	</div>
	)
}
