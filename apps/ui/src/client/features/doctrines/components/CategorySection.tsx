/**
 * Category Section Component
 *
 * Collapsible section for displaying doctrines grouped by category
 */

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { DoctrineCard } from './DoctrineCard'

import type { Doctrine } from '../types'

interface CategorySectionProps {
	category: string
	doctrines: Doctrine[]
	defaultExpanded?: boolean
}

export function CategorySection({
	category,
	doctrines,
	defaultExpanded = true,
}: CategorySectionProps) {
	const [isExpanded, setIsExpanded] = useState(defaultExpanded)

	return (
		<div className="space-y-4">
			{/* Category Header */}
			<Button
				variant="ghost"
				className="w-full justify-between p-4 h-auto hover:bg-accent"
				onClick={() => setIsExpanded(!isExpanded)}
			>
				<div className="flex items-center gap-2">
					{isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
					<h3 className="text-lg font-semibold">{category}</h3>
					<span className="text-sm text-muted-foreground">({doctrines.length})</span>
				</div>
			</Button>

			{/* Doctrine Cards */}
			{isExpanded && (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{doctrines.map((doctrine) => (
						<DoctrineCard key={doctrine.id} doctrine={doctrine} />
					))}
				</div>
			)}
		</div>
	)
}
