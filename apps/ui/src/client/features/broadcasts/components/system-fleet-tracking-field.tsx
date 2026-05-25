import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

interface CharacterOption {
	characterId: string
	characterName: string
}

interface SystemFleetTrackingFieldProps {
	enabled: boolean
	onEnabledChange: (enabled: boolean) => void
	characterId: string
	onCharacterIdChange: (characterId: string) => void
	characters: CharacterOption[]
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
	characterId,
	onCharacterIdChange,
	characters,
}: SystemFleetTrackingFieldProps) {
	const characterOptions = characters.map((c) => ({
		value: c.characterId,
		label: c.characterName,
	}))
	const switchId = 'fleet-tracking-toggle'

	return (
		<div className="max-w-xl space-y-2">
			<div
				className={`flex items-center justify-between rounded-md border border-border/60 px-3 py-2 cursor-pointer transition-colors ${
					enabled ? 'bg-slate-500/15' : 'bg-transparent'
				}`}
				onClick={(event) => {
					if (isSwitchControlClick(event.target)) return
					toggleSwitchById(switchId)
				}}
			>
				<Label htmlFor={switchId} className="font-medium cursor-pointer">
					Start fleet tracking when broadcast is sent
				</Label>
				<Switch
					id={switchId}
					checked={enabled}
					onClick={(event) => event.stopPropagation()}
					onCheckedChange={onEnabledChange}
				/>
			</div>
			{enabled && (
				<div className="space-y-1.5 pt-1">
					<Label htmlFor="fleet-tracking-character" className="text-sm text-muted-foreground">
						Track as character
					</Label>
					<Select
						inputId="fleet-tracking-character"
						value={characterId}
						onValueChange={onCharacterIdChange}
						options={characterOptions}
						placeholder="Select character"
					/>
					<p className="text-xs text-muted-foreground">
						Character must be fleet boss at the moment the broadcast is sent. The fleet name
						will be the broadcast title.
					</p>
				</div>
			)}
		</div>
	)
}
