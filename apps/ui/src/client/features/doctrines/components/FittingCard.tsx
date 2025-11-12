/**
 * Fitting Card Component
 *
 * Displays a fitting in card format with ship info and SRP status
 */

import { CheckCircle2, DollarSign, Ship, User } from 'lucide-react'
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

import { formatISK } from '../utils'

import type { Fitting } from '../types'

interface FittingCardProps {
	fitting: Fitting
}

export function FittingCard({ fitting }: FittingCardProps) {
	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="flex-1">
						<CardTitle className="flex items-center gap-2">
							<Ship className="h-5 w-5 text-primary" />
							{fitting.shipName}
						</CardTitle>
						<CardDescription className="mt-1">{fitting.category}</CardDescription>
					</div>
					{fitting.srpEligible && (
						<Badge variant="default" className="flex items-center gap-1">
							<CheckCircle2 className="h-3 w-3" />
							SRP
						</Badge>
					)}
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-2 text-sm">
					<div className="flex items-center gap-2 text-muted-foreground">
						<User className="h-4 w-4" />
						<span>{fitting.maintainer}</span>
					</div>
					{fitting.srpEligible && (
						<div className="flex items-center gap-2 text-muted-foreground">
							<DollarSign className="h-4 w-4" />
							<span>{formatISK(fitting.srpValue)}</span>
						</div>
					)}
				</div>
			</CardContent>
			<CardFooter>
				<Button variant="outline" size="sm" asChild className="w-full">
					<Link to={`/doctrines/fittings/${fitting.id}`}>View Details</Link>
				</Button>
			</CardFooter>
		</Card>
	)
}
