/**
 * Doctrine Card Component
 *
 * Displays a doctrine in card format with action buttons
 */

import { BookMarked, Calendar, User } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'

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
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="flex-1">
						<CardTitle className="flex items-center gap-2">
							<BookMarked className="h-5 w-5" />
							{doctrine.name}
						</CardTitle>
						<CardDescription className="mt-1">{doctrine.category}</CardDescription>
					</div>
					{fittingCount !== undefined && <Badge variant="secondary">{fittingCount} fittings</Badge>}
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-2 text-sm">
					<div className="flex items-center gap-2 text-muted-foreground">
						<User className="h-4 w-4" />
						<span>Maintained by {doctrine.maintainer}</span>
					</div>
					<div className="flex items-center gap-2 text-muted-foreground">
						<Calendar className="h-4 w-4" />
						<span>Updated {formattedDate}</span>
					</div>
				</div>
			</CardContent>
			<CardFooter>
				<Button variant="ghost" size="sm" asChild className="w-full">
					<Link to={`/doctrines/${doctrine.id}`}>View Details</Link>
				</Button>
			</CardFooter>
		</Card>
	)
}
