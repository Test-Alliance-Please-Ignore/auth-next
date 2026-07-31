/**
 * Fitting Card Component
 *
 * Displays a fitting in card format with ship icon and SRP status
 */

import { CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

import { typeIconUrl } from '@/lib/eve-images'

import type { Fitting } from '../types'

interface FittingCardProps {
	fitting: Fitting
	doctrineId?: string
}

export function FittingCard({ fitting, doctrineId }: FittingCardProps) {
	const linkTo = doctrineId
		? `/doctrines/fittings/${fitting.id}?doctrineId=${doctrineId}`
		: `/doctrines/fittings/${fitting.id}`

	return (
		<Link to={linkTo} className="block group">
			<Card className="transition-colors hover:bg-accent/50 h-full">
				<CardContent className="flex items-center gap-3 py-3">
					{/* Ship icon from EVE image server */}
					<img
						src={typeIconUrl(fitting.shipTypeId, 64)}
						alt={fitting.shipName}
						className="h-10 w-10 rounded shrink-0"
						loading="lazy"
					/>

					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span className="font-medium text-sm truncate">{fitting.name}</span>
							{fitting.srpEligible && (
								<Badge variant="default" className="flex items-center gap-1 shrink-0 text-xs">
									<CheckCircle2 className="h-3 w-3" />
									SRP Eligible
								</Badge>
							)}
						</div>
						<p className="text-xs text-muted-foreground truncate">{fitting.shipName} &middot; {fitting.category}</p>
					</div>
				</CardContent>
			</Card>
		</Link>
	)
}
