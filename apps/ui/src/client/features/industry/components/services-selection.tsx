import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import { SERVICE_TYPE_CATEGORIES, SERVICE_TYPE_LABELS, ServiceType } from '../types'

interface ServicesSelectionProps {
	selectedServices: ServiceType[]
	onChange: (services: ServiceType[]) => void
	disabled?: boolean
	excludeServices?: ServiceType[]
}

export function ServicesSelection({
	selectedServices,
	onChange,
	disabled,
	excludeServices = [],
}: ServicesSelectionProps) {
	const toggleService = (serviceType: ServiceType) => {
		if (selectedServices.includes(serviceType)) {
			onChange(selectedServices.filter((s) => s !== serviceType))
		} else {
			onChange([...selectedServices, serviceType])
		}
	}

	const selectAll = () => {
		const allAvailable = Object.values(ServiceType).filter(
			(type) => !excludeServices.includes(type)
		)
		onChange(allAvailable)
	}

	const clearAll = () => {
		onChange([])
	}

	const availableCount = Object.values(ServiceType).filter(
		(type) => !excludeServices.includes(type)
	).length

	return (
		<div className="space-y-6">
			{/* Header with select/clear buttons */}
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">
					{selectedServices.length} of {availableCount} services selected
				</p>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={selectAll}
						disabled={disabled || selectedServices.length === availableCount}
						className="text-sm text-primary hover:underline disabled:opacity-50 disabled:no-underline"
					>
						Select All
					</button>
					<span className="text-muted-foreground">|</span>
					<button
						type="button"
						onClick={clearAll}
						disabled={disabled || selectedServices.length === 0}
						className="text-sm text-primary hover:underline disabled:opacity-50 disabled:no-underline"
					>
						Clear All
					</button>
				</div>
			</div>

			{/* Categories */}
			{Object.entries(SERVICE_TYPE_CATEGORIES).map(([category, types]) => {
				const availableTypes = types.filter((type) => !excludeServices.includes(type))
				if (availableTypes.length === 0) return null

				return (
					<div key={category} className="space-y-3">
						<h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
							{category}
						</h3>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{availableTypes.map((serviceType) => (
								<label
									key={serviceType}
									className={cn(
										'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
										selectedServices.includes(serviceType)
											? 'border-primary bg-primary/5'
											: 'border-border hover:border-primary/50',
										disabled && 'opacity-50 cursor-not-allowed'
									)}
								>
									<Checkbox
										checked={selectedServices.includes(serviceType)}
										onCheckedChange={() => toggleService(serviceType)}
										disabled={disabled}
									/>
									<span className="text-sm">{SERVICE_TYPE_LABELS[serviceType]}</span>
								</label>
							))}
						</div>
					</div>
				)
			})}
		</div>
	)
}
