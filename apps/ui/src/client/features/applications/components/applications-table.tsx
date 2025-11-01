/**
 * Applications Table Component
 *
 * Full-featured data table for displaying applications with sorting, filtering, and pagination.
 * Responsive: collapses to card view on mobile devices.
 */

import { formatDistanceToNow } from 'date-fns'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, MessageSquare, Search } from 'lucide-react'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { MemberAvatar } from '@/components/member-avatar'
import { cn } from '@/lib/utils'

import { ApplicationCard } from './application-card'
import { ApplicationStatusBadge } from './application-status-badge'

import type { Application, ApplicationStatus } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface ApplicationsTableProps {
	applications: Application[]
	loading?: boolean
	onApplicationClick?: (app: Application) => void
	filters?: {
		status?: ApplicationStatus[]
		search?: string
	}
	onFilterChange?: (filters: ApplicationsTableProps['filters']) => void
	canManage?: boolean
}

type SortField = 'characterName' | 'status' | 'submittedAt' | 'recommendationCount'
type SortDirection = 'asc' | 'desc' | null

// ============================================================================
// Constants
// ============================================================================

const ITEMS_PER_PAGE = 25

// ============================================================================
// Hooks
// ============================================================================

/**
 * Custom hook for debouncing search input
 */
function useDebounce<T>(value: T, delay: number): T {
	const [debouncedValue, setDebouncedValue] = useState<T>(value)

	React.useEffect(() => {
		const handler = setTimeout(() => {
			setDebouncedValue(value)
		}, delay)

		return () => {
			clearTimeout(handler)
		}
	}, [value, delay])

	return debouncedValue
}

// ============================================================================
// Component
// ============================================================================

/**
 * Applications table with sorting, filtering, and pagination
 *
 * @example
 * ```tsx
 * <ApplicationsTable
 *   applications={applications}
 *   onApplicationClick={(app) => navigate(`/applications/${app.id}`)}
 *   canManage={true}
 * />
 * ```
 */
export function ApplicationsTable({
	applications,
	loading = false,
	onApplicationClick,
	filters,
	onFilterChange,
	canManage = false,
}: ApplicationsTableProps) {
	const navigate = useNavigate()

	// Local state
	const [searchTerm, setSearchTerm] = useState(filters?.search || '')
	const [sortField, setSortField] = useState<SortField | null>(null)
	const [sortDirection, setSortDirection] = useState<SortDirection>(null)
	const [currentPage, setCurrentPage] = useState(1)

	// Debounce search term
	const debouncedSearchTerm = useDebounce(searchTerm, 300)

	// Filter applications
	const filteredApplications = useMemo(() => {
		let filtered = [...applications]

		// Filter by status
		if (filters?.status && filters.status.length > 0) {
			filtered = filtered.filter((app) => filters.status?.includes(app.status))
		}

		// Filter by search term
		if (debouncedSearchTerm) {
			const searchLower = debouncedSearchTerm.toLowerCase()
			filtered = filtered.filter((app) =>
				app.characterName.toLowerCase().includes(searchLower)
			)
		}

		return filtered
	}, [applications, filters?.status, debouncedSearchTerm])

	// Sort applications
	const sortedApplications = useMemo(() => {
		if (!sortField || !sortDirection) return filteredApplications

		return [...filteredApplications].sort((a, b) => {
			let aValue: any
			let bValue: any

			switch (sortField) {
				case 'characterName':
					aValue = a.characterName.toLowerCase()
					bValue = b.characterName.toLowerCase()
					break
				case 'status':
					aValue = a.status
					bValue = b.status
					break
				case 'submittedAt':
					aValue = new Date(a.createdAt).getTime()
					bValue = new Date(b.createdAt).getTime()
					break
				case 'recommendationCount':
					aValue = a.recommendationCount || 0
					bValue = b.recommendationCount || 0
					break
				default:
					return 0
			}

			if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
			if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
			return 0
		})
	}, [filteredApplications, sortField, sortDirection])

	// Paginate applications
	const paginatedApplications = useMemo(() => {
		const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
		const endIndex = startIndex + ITEMS_PER_PAGE
		return sortedApplications.slice(startIndex, endIndex)
	}, [sortedApplications, currentPage])

	// Calculate total pages
	const totalPages = Math.ceil(sortedApplications.length / ITEMS_PER_PAGE)

	// Handlers
	const handleSort = useCallback(
		(field: SortField) => {
			if (sortField === field) {
				// Cycle through: asc -> desc -> null
				if (sortDirection === 'asc') {
					setSortDirection('desc')
				} else if (sortDirection === 'desc') {
					setSortField(null)
					setSortDirection(null)
				}
			} else {
				setSortField(field)
				setSortDirection('asc')
			}
		},
		[sortField, sortDirection]
	)

	const handleSearchChange = useCallback(
		(value: string) => {
			setSearchTerm(value)
			setCurrentPage(1) // Reset to first page on search
			if (onFilterChange) {
				onFilterChange({
					...filters,
					search: value,
				})
			}
		},
		[filters, onFilterChange]
	)

	const handleRowClick = useCallback(
		(app: Application) => {
			if (onApplicationClick) {
				onApplicationClick(app)
			}
		},
		[onApplicationClick]
	)

	const handlePrevPage = useCallback(() => {
		setCurrentPage((prev) => Math.max(1, prev - 1))
	}, [])

	const handleNextPage = useCallback(() => {
		setCurrentPage((prev) => Math.min(totalPages, prev + 1))
	}, [totalPages])

	// Render sort indicator
	const renderSortIndicator = useCallback(
		(field: SortField) => {
			if (sortField !== field) return null

			return sortDirection === 'asc' ? (
				<ArrowUp className="ml-1 h-4 w-4 inline" />
			) : (
				<ArrowDown className="ml-1 h-4 w-4 inline" />
			)
		},
		[sortField, sortDirection]
	)

	// Empty state
	if (!loading && applications.length === 0) {
		return (
			<Card>
				<CardContent className="py-12 text-center">
					<p className="text-muted-foreground">No applications found</p>
				</CardContent>
			</Card>
		)
	}

	// No results state (after filtering)
	if (!loading && filteredApplications.length === 0) {
		return (
			<Card>
				<CardContent className="py-12 text-center">
					<p className="text-muted-foreground">
						No applications match your search or filters
					</p>
					{searchTerm && (
						<Button
							variant="outline"
							className="mt-4"
							onClick={() => handleSearchChange('')}
						>
							Clear Search
						</Button>
					)}
				</CardContent>
			</Card>
		)
	}

	return (
		<div className="space-y-4">
			{/* Search Bar */}
			<div className="relative">
				<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
				<Input
					type="search"
					placeholder="Search by character name..."
					value={searchTerm}
					onChange={(e) => handleSearchChange(e.target.value)}
					className="pl-10"
				/>
			</div>

			{/* Desktop Table View */}
			<div className="hidden md:block">
				<Card>
					<CardContent className="p-0">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead
										className="cursor-pointer select-none hover:bg-muted/50"
										onClick={() => handleSort('characterName')}
									>
										Character
										{renderSortIndicator('characterName')}
									</TableHead>
									<TableHead>Corporation</TableHead>
									<TableHead
										className="cursor-pointer select-none hover:bg-muted/50"
										onClick={() => handleSort('status')}
									>
										Status
										{renderSortIndicator('status')}
									</TableHead>
									<TableHead
										className="cursor-pointer select-none hover:bg-muted/50"
										onClick={() => handleSort('submittedAt')}
									>
										Submitted
										{renderSortIndicator('submittedAt')}
									</TableHead>
									<TableHead
										className="cursor-pointer select-none hover:bg-muted/50 text-center"
										onClick={() => handleSort('recommendationCount')}
									>
										Recommendations
										{renderSortIndicator('recommendationCount')}
									</TableHead>
									{canManage && <TableHead className="text-right">Actions</TableHead>}
								</TableRow>
							</TableHeader>
							<TableBody>
								{loading ? (
									<TableRow>
										<TableCell colSpan={canManage ? 6 : 5} className="text-center py-12">
											<p className="text-muted-foreground">Loading applications...</p>
										</TableCell>
									</TableRow>
								) : (
									paginatedApplications.map((app) => (
										<TableRow
											key={app.id}
											className={cn(
												'transition-colors',
												onApplicationClick && 'cursor-pointer hover:bg-muted/75'
											)}
											onClick={() => handleRowClick(app)}
										>
											{/* Character */}
											<TableCell>
												<div className="flex items-center gap-3">
													<MemberAvatar
														characterId={app.characterId}
														characterName={app.characterName}
														size="sm"
													/>
													<span className="font-medium">{app.characterName}</span>
												</div>
											</TableCell>

											{/* Corporation */}
											<TableCell>
												<span className="text-muted-foreground">
													{app.corporationName || 'Unknown'}
												</span>
											</TableCell>

											{/* Status */}
											<TableCell>
												<ApplicationStatusBadge status={app.status} size="sm" />
											</TableCell>

											{/* Submitted */}
											<TableCell>
												<span className="text-sm text-muted-foreground">
													{formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
												</span>
											</TableCell>

											{/* Recommendations */}
											<TableCell className="text-center">
												{app.recommendationCount !== undefined && app.recommendationCount > 0 ? (
													<div className="inline-flex items-center gap-1.5 text-muted-foreground">
														<MessageSquare className="h-4 w-4" />
														<span className="font-medium">{app.recommendationCount}</span>
													</div>
												) : (
													<span className="text-muted-foreground">-</span>
												)}
											</TableCell>

											{/* Actions */}
											{canManage && (
												<TableCell className="text-right">
													<Button
														variant="ghost"
														size="sm"
														onClick={(e) => {
															e.stopPropagation()
															handleRowClick(app)
														}}
													>
														View
													</Button>
												</TableCell>
											)}
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			</div>

			{/* Mobile Card View */}
			<div className="md:hidden space-y-3">
				{loading ? (
					<Card>
						<CardContent className="py-12 text-center">
							<p className="text-muted-foreground">Loading applications...</p>
						</CardContent>
					</Card>
				) : (
					paginatedApplications.map((app) => (
						<ApplicationCard
							key={app.id}
							application={app}
							onClick={onApplicationClick ? () => onApplicationClick(app) : undefined}
						/>
					))
				)}
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex items-center justify-between">
					<p className="text-sm text-muted-foreground">
						Page {currentPage} of {totalPages} ({sortedApplications.length} total)
					</p>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={handlePrevPage}
							disabled={currentPage === 1}
						>
							<ChevronLeft className="h-4 w-4 mr-1" />
							Previous
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={handleNextPage}
							disabled={currentPage === totalPages}
						>
							Next
							<ChevronRight className="h-4 w-4 ml-1" />
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}
