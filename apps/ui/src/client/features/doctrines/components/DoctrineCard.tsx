/**
 * Doctrine Card Component
 *
 * Full-width card displaying a doctrine with metadata
 */

import { Calendar, ChevronRight, Ship, User } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { typeIconUrl } from '@/lib/eve-images'

import type { Doctrine } from '../types'

interface DoctrineCardProps {
	doctrine: Doctrine
	fittingCount?: number
}

export function DoctrineCard({ doctrine, fittingCount }: DoctrineCardProps) {
	const formattedDate = new Date(doctrine.updatedAt).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})

	return (
		<Link to={`/doctrines/${doctrine.id}`} className="block group">
			<Card className="transition-colors hover:bg-accent/50">
				<CardContent className="flex items-center gap-4 py-4">
{/* Ship icon */}
				<div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary/10">
					{doctrine.shipTypeId ? (
						<img
							src={typeIconUrl(doctrine.shipTypeId, 64)}
							alt=""
							className="h-14 w-14 rounded-lg"
						/>
					) : (
						<Ship className="h-7 w-7 text-primary" />
					)}
					</div>

					{/* Main content */}
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<h3 className="font-semibold text-base truncate">{doctrine.name}</h3>
							{fittingCount !== undefined && (
								<Badge variant="secondary" className="shrink-0">
									{fittingCount} {fittingCount === 1 ? 'fit' : 'fits'}
								</Badge>
							)}
						</div>
						{doctrine.description && (
							<p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
								{doctrine.description}
							</p>
						)}
						<div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
							{doctrine.updatedBy && (
								<span className="flex items-center gap-1">
									<User className="h-3 w-3" />
									{doctrine.updatedBy}
								</span>
							)}
							<span className="flex items-center gap-1">
								<Calendar className="h-3 w-3" />
								{formattedDate}
							</span>
						</div>
					</div>

					{/* Arrow */}
					<ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
				</CardContent>
			</Card>
		</Link>
	)
}
