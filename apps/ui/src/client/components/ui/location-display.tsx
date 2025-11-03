import { Badge } from './badge'
import { Skeleton } from './skeleton'

import { useSystemDetails } from '@/hooks/useLocationSearch'

import type { FreightLocation } from '@repo/freight'

interface LocationDisplayProps {
	location: FreightLocation
	showBadge?: boolean
}

export function LocationDisplay({ location, showBadge = false }: LocationDisplayProps) {
	const { data: systemDetails, isLoading } = useSystemDetails(location.solarSystemId)

	if (isLoading) {
		return <Skeleton className="h-5 w-48" />
	}

	if (!systemDetails) {
		return <span className="text-muted-foreground">Unknown Location</span>
	}

	// Determine location type from IDs
	const isStructure =
		location.structureId && String(location.structureId) !== String(location.solarSystemId)
	const type = isStructure ? 'structure' : 'system'

	return (
		<div className="flex items-center gap-2">
			<span>
				{systemDetails.name}
				{location.constellationId && (
					<span className="text-muted-foreground text-sm"> (Region)</span>
				)}
			</span>
			{showBadge && (
				<Badge variant={type === 'structure' ? 'outline' : 'default'} className="text-xs">
					{type}
				</Badge>
			)}
		</div>
	)
}
