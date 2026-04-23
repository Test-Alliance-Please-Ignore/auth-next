import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface SystemFrogsirenFieldProps {
	fieldName: string
	checked: boolean
	onDisable: () => void
	onConfirmEnable: () => void
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

export function SystemFrogsirenField({
	fieldName,
	checked,
	onDisable,
	onConfirmEnable,
}: SystemFrogsirenFieldProps) {
	return (
		<div className="max-w-xl">
			<div
				className={`flex items-center justify-between rounded-md border border-border/60 px-3 py-2 cursor-pointer transition-colors ${
					checked ? 'bg-slate-500/15' : 'bg-transparent'
				}`}
				onClick={(event) => {
					if (isSwitchControlClick(event.target)) return
					toggleSwitchById(fieldName)
				}}
			>
				<Label htmlFor={fieldName} className="text-2xl font-black cursor-pointer">
					Sound the Frogsiren
				</Label>
				<Switch
					id={fieldName}
					checked={checked}
					onClick={(event) => event.stopPropagation()}
					onCheckedChange={(nextChecked) => {
						if (!nextChecked) {
							onDisable()
							return
						}
						onConfirmEnable()
					}}
				/>
			</div>
		</div>
	)
}
