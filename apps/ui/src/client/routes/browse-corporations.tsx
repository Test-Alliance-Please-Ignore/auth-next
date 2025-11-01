/**
 * Join Corporations Page
 *
 * Public page where authenticated users can discover and apply to member corporations.
 * Features search functionality, grid layout, and integration with application system.
 */

import { useQuery } from '@tanstack/react-query'
import { Building2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { usePublicCorporations } from '@/hooks/useCorporations'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

import type { ManagedCorporation } from '@/lib/api'

// ============================================================================
// Types
// ============================================================================

interface CorporationCardProps {
	corporation: ManagedCorporation
	onClick: (corporationId: string) => void
}

// ============================================================================
// Corporation Card Component
// ============================================================================

function CorporationCard({ corporation, onClick }: CorporationCardProps) {
	return (
		<Card
			variant="elevated"
			className="transition-all hover:border-primary/50 hover:shadow-lg"
		>
			<CardHeader className="pb-4">
				<div className="flex items-start gap-4">
					<div className="p-3 bg-primary/10 rounded-lg">
						<Building2 className="h-12 w-12 text-primary" />
					</div>
					<div className="flex-1 min-w-0">
						<CardTitle className="text-lg font-semibold mb-1 truncate">
							{corporation.name}
						</CardTitle>
						<CardDescription className="text-sm text-muted-foreground">
							[{corporation.ticker}]
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Corporation Info */}
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Users className="h-4 w-4" />
					<span>Member Corporation</span>
				</div>

				{/* Short Description */}
				{corporation.shortDescription && (
					<p className="text-sm text-muted-foreground line-clamp-3">
						{corporation.shortDescription}
					</p>
				)}

				{/* View Details Button */}
				<Button
					className="w-full"
					onClick={() => onClick(corporation.corporationId)}
				>
					View Details
				</Button>
			</CardContent>
		</Card>
	)
}

// ============================================================================
// Loading Skeleton
// ============================================================================

function CorporationCardSkeleton() {
	return (
		<Card variant="elevated">
			<CardHeader className="pb-4">
				<div className="flex items-start gap-4">
					<Skeleton className="h-[72px] w-[72px] rounded-lg" />
					<div className="flex-1 space-y-2">
						<Skeleton className="h-6 w-3/4" />
						<Skeleton className="h-4 w-1/4" />
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<Skeleton className="h-5 w-1/2" />
				<Skeleton className="h-10 w-full" />
			</CardContent>
		</Card>
	)
}

// ============================================================================
// Main Component
// ============================================================================

export default function BrowseCorporations() {
	usePageTitle('Join Corporations')

	const navigate = useNavigate()
	const { isAuthenticated, isLoading: authLoading } = useAuth()
	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedQuery, setDebouncedQuery] = useState('')

	// Debounce search input
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(searchQuery)
		}, 300)
		return () => clearTimeout(timer)
	}, [searchQuery])

	// Fetch corporations based on search
	const publicCorpsQuery = usePublicCorporations()
	const searchCorpsQuery = useQuery({
		queryKey: ['corporations', 'search', debouncedQuery],
		queryFn: () => api.searchCorporations(debouncedQuery),
		enabled: debouncedQuery.length > 0,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})

	// Use search results if searching, otherwise use all public corporations
	const corporations = debouncedQuery ? searchCorpsQuery.data : publicCorpsQuery.data
	const isLoading = debouncedQuery ? searchCorpsQuery.isLoading : publicCorpsQuery.isLoading

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/" replace />
	}

	// Handlers
	const handleCorporationClick = (corporationId: string) => {
		navigate(`/join/${corporationId}`)
	}

	const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
		setSearchQuery(e.target.value)
	}

	return (
		<Container size="wide">
			<PageHeader
				title="Join Corporations"
				description="Find and join EVE Online member corporations"
			/>

			{/* Search */}
			<div className="mb-6">
				<Input
					type="text"
					placeholder="Search corporations by name or ticker..."
					value={searchQuery}
					onChange={handleSearch}
					className="max-w-md"
				/>
			</div>

			{/* Loading State */}
			{isLoading && (
				<div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
					{Array.from({ length: 6 }).map((_, i) => (
						<CorporationCardSkeleton key={i} />
					))}
				</div>
			)}

			{/* Empty State */}
			{!isLoading && corporations && corporations.length === 0 && (
				<Card className="max-w-2xl mx-auto">
					<CardContent className="py-12 text-center">
						<Building2 className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
						<CardTitle className="text-xl mb-2">No Corporations Found</CardTitle>
						<CardDescription>
							{debouncedQuery
								? 'No corporations match your search. Try adjusting your search terms.'
								: 'No member corporations are currently available for applications.'}
						</CardDescription>
					</CardContent>
				</Card>
			)}

			{/* Corporation Cards Grid */}
			{!isLoading && corporations && corporations.length > 0 && (
				<div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
					{corporations.map((corp) => (
						<CorporationCard
							key={corp.corporationId}
							corporation={corp}
							onClick={handleCorporationClick}
						/>
					))}
				</div>
			)}
		</Container>
	)
}
