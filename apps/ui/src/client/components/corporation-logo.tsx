import { Building2 } from 'lucide-react'
import { useState } from 'react'

import { allianceLogoUrl, corporationLogoUrl } from '@/lib/eve-images'
import { cn } from '@/lib/utils'

interface CorporationLogoProps {
	corporationId: string | number
	corporationName?: string | null
	size?: 'sm' | 'md' | 'lg'
	className?: string
}

const sizeClasses = {
	sm: 'h-5 w-5',
	md: 'h-6 w-6',
	lg: 'h-8 w-8',
}

export function CorporationLogo({
	corporationId,
	corporationName,
	size = 'sm',
	className,
}: CorporationLogoProps) {
	const [hasError, setHasError] = useState(false)

	return (
		<div
			className={cn(
				sizeClasses[size],
				'flex-shrink-0 overflow-hidden rounded-sm border border-border/60 bg-muted',
				className
			)}
		>
			{!hasError ? (
				<img
					src={corporationLogoUrl(corporationId, 32)}
					alt={corporationName ? `${corporationName} logo` : 'Corporation logo'}
					className="h-full w-full object-cover"
					loading="lazy"
					onError={() => setHasError(true)}
				/>
			) : (
				<div className="flex h-full w-full items-center justify-center text-muted-foreground">
					<Building2 className="h-3 w-3" />
				</div>
			)}
		</div>
	)
}

interface OrganizationLogoProps extends CorporationLogoProps {
	allianceId?: string | number | null
	allianceName?: string | null
}

export function OrganizationLogo({
	corporationId,
	corporationName,
	allianceId,
	allianceName,
	size = 'sm',
	className,
}: OrganizationLogoProps) {
	const [useCorporationFallback, setUseCorporationFallback] = useState(false)
	const showAlliance = Boolean(allianceId) && !useCorporationFallback
	const imageUrl = showAlliance
		? allianceLogoUrl(allianceId!, 32)
		: corporationLogoUrl(corporationId, 32)

	return (
		<div className={cn(sizeClasses[size], 'flex-shrink-0 overflow-hidden rounded-sm', className)}>
			<img
				src={imageUrl}
				alt={
					showAlliance
						? `${allianceName ?? 'Alliance'} logo`
						: `${corporationName ?? 'Corporation'} logo`
				}
				className="h-full w-full object-cover"
				loading="lazy"
				onError={() => {
					if (showAlliance) setUseCorporationFallback(true)
				}}
			/>
		</div>
	)
}
