import { cn } from '@/lib/utils'

import { Button } from './button'

export interface SegmentedControlOption<Value extends string> {
	value: Value
	label: string
}

interface SegmentedControlProps<Value extends string> {
	options: ReadonlyArray<SegmentedControlOption<Value>>
	value: Value
	onValueChange: (value: Value) => void
	'aria-label': string
	className?: string
}

export function SegmentedControl<Value extends string>({
	options,
	value,
	onValueChange,
	'aria-label': ariaLabel,
	className,
}: SegmentedControlProps<Value>) {
	return (
		<div
			className={cn(
				'flex items-center overflow-hidden rounded-md border border-border bg-card p-1',
				className
			)}
			role="group"
			aria-label={ariaLabel}
		>
			{options.map((option) => {
				const isSelected = value === option.value
				return (
					<Button
						key={option.value}
						type="button"
						variant={isSelected ? 'primary' : 'ghost'}
						size="sm"
						showIcon={false}
						aria-pressed={isSelected}
						className="h-8 rounded-none border-0 px-3 shadow-none first:rounded-l-sm last:rounded-r-sm hover:shadow-none"
						onClick={() => onValueChange(option.value)}
					>
						{option.label}
					</Button>
				)
			})}
		</div>
	)
}
