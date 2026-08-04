import { formatDistanceToNow } from 'date-fns'
import {
	Building2,
	Plus,
	RefreshCw,
	Search,
	ShieldAlert,
	ShieldCheck,
	Trash2,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { TableRefreshFrame } from '@/components/table-refresh-frame'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import {
	useCorporations,
	useCreateCorporation,
	useDeleteCorporation,
	useUpdateCorporation,
	useVerifyCorporationAccess,
} from '@/hooks/useCorporations'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { CorporationsFilters, CreateCorporationRequest } from '@/lib/api'

export default function CorporationsPage() {
	usePageTitle('Admin - Corporations')

	// Filter state
	const [filters, setFilters] = useState<CorporationsFilters>({
		corporationType: 'member',
		page: 1,
		pageSize: 25,
	})
	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearchQuery(searchQuery.trim())
			setFilters((current) => ({ ...current, page: 1 }))
		}, 300)

		return () => clearTimeout(timer)
	}, [searchQuery])

	const { data, isLoading, isFetching, error } = useCorporations({
		...filters,
		search: debouncedSearchQuery || undefined,
	})
	const corporations = data?.data ?? []
	const pagination = data?.pagination
	const isInitialLoading = isLoading && !data
	const isSoftLoading = Boolean(data) && isFetching

	useEffect(() => {
		const totalPages = pagination?.totalPages ?? 0
		const currentPage = filters.page ?? 1
		if (totalPages > 0 && currentPage > totalPages) {
			setFilters((current) => ({ ...current, page: totalPages }))
		}
	}, [filters.page, pagination?.totalPages])

	const createCorporation = useCreateCorporation()
	const deleteCorporation = useDeleteCorporation()
	const updateCorporation = useUpdateCorporation()
	const verifyAccess = useVerifyCorporationAccess()

	// Message handling with automatic cleanup
	const { message, showSuccess, showError } = useMessage()

	// Dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedCorpId, setSelectedCorpId] = useState<string | null>(null)

	// Form state
	const [formData, setFormData] = useState<CreateCorporationRequest>({
		corporationId: '',
		name: '',
		ticker: '',
		assignedCharacterId: undefined,
		assignedCharacterName: undefined,
		includeInBackgroundRefresh: false,
		includeInStructureAssetSync: false,
	})

	// Check if any filters are active (different from default)
	const hasActiveFilters = filters.corporationType !== 'member' || searchQuery.trim().length > 0

	// Clear all filters (reset to default)
	const clearFilters = () => {
		setSearchQuery('')
		setDebouncedSearchQuery('')
		setFilters({ corporationType: 'member', page: 1, pageSize: filters.pageSize ?? 25 })
	}

	const handlePageSizeChange = (pageSize: number) => {
		if (pageSize !== 25 && pageSize !== 50 && pageSize !== 100) return
		setFilters((current) => ({ ...current, page: 1, pageSize }))
	}

	// Handlers
	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault()

		// Validate corporation ID is a valid number
		if (!formData.corporationId) {
			showError('Please enter a valid corporation ID')
			return
		}

		try {
			await createCorporation.mutateAsync(formData)
			setCreateDialogOpen(false)
			setFormData({
				corporationId: '',
				name: '',
				ticker: '',
				assignedCharacterId: undefined,
				assignedCharacterName: undefined,
				includeInBackgroundRefresh: false,
				includeInStructureAssetSync: false,
			})
			showSuccess('Corporation added successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to add corporation')
		}
	}

	const handleDelete = async () => {
		if (!selectedCorpId) return
		try {
			await deleteCorporation.mutateAsync(selectedCorpId)
			setDeleteDialogOpen(false)
			setSelectedCorpId(null)
			showSuccess('Corporation removed successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to remove corporation')
		}
	}

	const handleVerify = async (corporationId: string) => {
		try {
			const result = await verifyAccess.mutateAsync(corporationId)
			if (result.hasAccess) {
				showSuccess('Access verified successfully!')
			} else {
				showError('Verification failed: Missing required roles')
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to verify access')
		}
	}

	const handleToggleBackgroundRefresh = async (corporationId: string, enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId,
				data: { includeInBackgroundRefresh: enabled },
			})
			showSuccess(`Background refresh ${enabled ? 'enabled' : 'disabled'}`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update setting')
		}
	}

	const handleToggleStructureAssetSync = async (corporationId: string, enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId,
				data: { includeInStructureAssetSync: enabled },
			})
			showSuccess(`Structure asset sync ${enabled ? 'enabled' : 'disabled'}`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update setting')
		}
	}

	const openDeleteDialog = useCallback((corporationId: string) => {
		setSelectedCorpId(corporationId)
		setDeleteDialogOpen(true)
	}, [])

	// Get verification status badge (memoized for performance)
	const getVerificationBadge = useCallback((corp: any) => {
		if (corp.isVerified) {
			return (
				<Badge variant="success" className="gap-1">
					<ShieldCheck className="h-3 w-3" />
					Verified
				</Badge>
			)
		}
		return (
			<Badge variant="destructive" className="gap-1">
				<ShieldAlert className="h-3 w-3" />
				Unverified
			</Badge>
		)
	}, [])

	// Format date (memoized for performance)
	const formatDate = useCallback((date: string | null) => {
		if (!date) return 'Never'
		const parsedDate = new Date(date)
		if (Number.isNaN(parsedDate.getTime())) return 'Never'
		return formatDistanceToNow(parsedDate, { addSuffix: true })
	}, [])

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Corporations</h1>
					<p className="text-muted-foreground mt-1">
						Manage EVE Online corporations and director assignments
					</p>
				</div>
				<Button onClick={() => setCreateDialogOpen(true)}>
					<Plus className="h-4 w-4" />
					Add Corporation
				</Button>
			</div>

			{/* Success/Error Message */}
			{message && (
				<Card
					className={
						message.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Search and Filters */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Search & Filters</CardTitle>
							<CardDescription>
								Search by corporation name or ticker, and filter by classification
							</CardDescription>
						</div>
						{hasActiveFilters && (
							<Button variant="ghost" size="sm" onClick={clearFilters}>
								<X className="h-4 w-4" />
								Clear Filters
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col gap-4">
						{/* Search Input */}
						<div className="relative flex-1">
							<Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Search corporations..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9"
							/>
						</div>

						{/* Filters */}
						<div className="flex gap-4">
							<div className="flex-1 space-y-2">
								<Label htmlFor="corporation-type-filter">Corporation Type</Label>
								<Select
									value={filters.corporationType ?? 'all'}
									onValueChange={(value) => {
										setFilters({
											corporationType:
												value === 'all'
													? undefined
													: (value as 'member' | 'alt' | 'special' | 'other'),
											page: 1,
											pageSize: filters.pageSize ?? 25,
										})
									}}
									inputId="corporation-type-filter"
									options={[
										{ value: 'all', label: 'All Corporations' },
										{ value: 'member', label: 'Member Corps' },
										{ value: 'alt', label: 'Alt Corps' },
										{ value: 'special', label: 'Special Purpose Corps' },
										{ value: 'other', label: 'Other Corps' },
									]}
									placeholder="All Corporations"
								/>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Corporations Table */}
			<Card>
				<CardHeader>
					<div className="space-y-4">
						<div>
							<CardTitle>Managed Corporations ({pagination?.totalCount ?? 0})</CardTitle>
							<CardDescription>Corporations configured for data collection</CardDescription>
						</div>
						<UserSearchPaginationControls
							totalCount={pagination?.totalCount ?? 0}
							page={filters.page ?? 1}
							pageSize={filters.pageSize ?? 25}
							onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
							onPageSizeChange={handlePageSizeChange}
							itemLabel="corporations"
							nextButtonLoading={isFetching}
						/>
					</div>
				</CardHeader>
				<CardContent>
					<TableRefreshFrame
						isRefreshing={isSoftLoading}
						refreshMessage="Loading corporations..."
						errorMessage={
							error && data
								? error instanceof Error
									? error.message
									: 'Failed to refresh corporations.'
								: null
						}
					>
						{error && !data ? (
							<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-8 text-center text-sm text-destructive">
								<div className="font-medium">Failed to load corporations.</div>
								<div className="mt-1 text-destructive/80">
									{error instanceof Error ? error.message : 'Please try again.'}
								</div>
							</div>
						) : isInitialLoading ? (
							<div className="flex justify-center py-8">
								<LoadingSpinner label="Loading corporations..." />
							</div>
						) : corporations.length === 0 ? (
							<div className="text-center py-8">
								<Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
								<h3 className="mt-4 text-lg font-medium">No corporations found</h3>
								<p className="text-muted-foreground mt-2">
									{searchQuery
										? 'Try adjusting your search'
										: 'Add your first corporation to get started'}
								</p>
							</div>
						) : (
							<>
								<div className="rounded-md border bg-card">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Corporation</TableHead>
												<TableHead>Directors</TableHead>
												<TableHead>Status</TableHead>
												<TableHead>Auto-Sync</TableHead>
												<TableHead>Asset Sync</TableHead>
												<TableHead>Last Sync</TableHead>
												<TableHead>Last Verified</TableHead>
												<TableHead className="text-right">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{corporations.map((corp) => (
												<TableRow key={corp.corporationId}>
													<TableCell>
														<div>
															<Link
																to={`/admin/corporations/${corp.corporationId}`}
																className="font-medium hover:underline"
															>
																{corp.name}
															</Link>
															<div className="text-sm text-muted-foreground">[{corp.ticker}]</div>
														</div>
													</TableCell>
													<TableCell>
														<div className="text-sm">
															<div>{`${corp.healthyDirectorCount} healthy`}</div>
															{corp.healthyDirectorCount === 0 && (
																<div className="text-amber-600 text-xs">Needs verification</div>
															)}
														</div>
													</TableCell>
													<TableCell>{getVerificationBadge(corp)}</TableCell>
													<TableCell>
														<Switch
															checked={corp.includeInBackgroundRefresh}
															onCheckedChange={(checked) =>
																handleToggleBackgroundRefresh(corp.corporationId, checked)
															}
															disabled={updateCorporation.isPending}
														/>
													</TableCell>
													<TableCell>
														<Switch
															checked={corp.includeInStructureAssetSync}
															onCheckedChange={(checked) =>
																handleToggleStructureAssetSync(corp.corporationId, checked)
															}
															disabled={updateCorporation.isPending}
														/>
													</TableCell>
													<TableCell>
														<span className="text-sm">{formatDate(corp.lastSync)}</span>
													</TableCell>
													<TableCell>
														<span className="text-sm">{formatDate(corp.lastVerified)}</span>
													</TableCell>
													<TableCell className="text-right">
														<div className="flex justify-end gap-2">
															{corp.assignedCharacterId && (
																<Button
																	variant="ghost"
																	size="sm"
																	onClick={() => handleVerify(corp.corporationId)}
																	disabled={verifyAccess.isPending}
																>
																	<RefreshCw className="h-4 w-4" />
																</Button>
															)}
															<Button
																variant="ghost"
																size="sm"
																onClick={() => openDeleteDialog(corp.corporationId)}
															>
																<Trash2 className="h-4 w-4 text-destructive" />
															</Button>
														</div>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
								{pagination && pagination.totalPages > 1 ? (
									<div className="mt-4 border-t border-border pt-4">
										<UserSearchPaginationControls
											totalCount={pagination.totalCount}
											page={filters.page ?? 1}
											pageSize={filters.pageSize ?? 25}
											onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
											onPageSizeChange={handlePageSizeChange}
											itemLabel="corporations"
											nextButtonLoading={isFetching}
										/>
									</div>
								) : null}
							</>
						)}
					</TableRefreshFrame>
				</CardContent>
			</Card>

			{/* Create Corporation Dialog */}
			<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add Corporation</DialogTitle>
						<DialogDescription>
							Add a new corporation for management. You can assign a director character later.
						</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleCreate}>
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="corporationId">Corporation ID *</Label>
								<Input
									id="corporationId"
									type="text"
									inputMode="numeric"
									pattern="[0-9]*"
									value={formData.corporationId}
									onChange={(e) => setFormData({ ...formData, corporationId: e.target.value })}
									required
									placeholder="e.g., 98000001"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="name">Corporation Name *</Label>
								<Input
									id="name"
									value={formData.name}
									onChange={(e) => setFormData({ ...formData, name: e.target.value })}
									required
									placeholder="e.g., Goonswarm Federation"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="ticker">Ticker *</Label>
								<Input
									id="ticker"
									value={formData.ticker}
									onChange={(e) => setFormData({ ...formData, ticker: e.target.value })}
									required
									placeholder="e.g., CONDI"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="characterId">Director Character ID (Optional)</Label>
								<Input
									id="characterId"
									type="text"
									inputMode="numeric"
									pattern="[0-9]*"
									value={formData.assignedCharacterId || ''}
									onChange={(e) =>
										setFormData({
											...formData,
											assignedCharacterId: e.target.value || undefined,
										})
									}
									placeholder="e.g., 2119123456"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="characterName">Director Character Name (Optional)</Label>
								<Input
									id="characterName"
									value={formData.assignedCharacterName || ''}
									onChange={(e) =>
										setFormData({ ...formData, assignedCharacterName: e.target.value || undefined })
									}
									placeholder="e.g., Character Name"
								/>
							</div>
							<div className="space-y-2">
								<div className="flex items-center space-x-2">
									<Switch
										id="includeInBackgroundRefresh"
										checked={formData.includeInBackgroundRefresh ?? false}
										onCheckedChange={(checked) =>
											setFormData({ ...formData, includeInBackgroundRefresh: checked })
										}
									/>
									<Label htmlFor="includeInBackgroundRefresh" className="cursor-pointer">
										Include in Background Refresh
									</Label>
								</div>
								<p className="text-sm text-muted-foreground">
									Automatically fetch and sync corporation data on a regular schedule
								</p>
							</div>
							<div className="space-y-2">
								<div className="flex items-center space-x-2">
									<Switch
										id="includeInStructureAssetSync"
										checked={formData.includeInStructureAssetSync ?? false}
										onCheckedChange={(checked) =>
											setFormData({ ...formData, includeInStructureAssetSync: checked })
										}
									/>
									<Label htmlFor="includeInStructureAssetSync" className="cursor-pointer">
										Include in Structure Asset Sync
									</Label>
								</div>
								<p className="text-sm text-muted-foreground">
									Fetch structure assets for this corporation during sync runs
								</p>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<Button variant="cancel" type="button" onClick={() => setCreateDialogOpen(false)}>
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={createCorporation.isPending}
								loadingText="Adding..."
							>
								Add Corporation
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove Corporation</DialogTitle>
						<DialogDescription>
							Are you sure you want to remove this corporation? This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
							loading={deleteCorporation.isPending}
							loadingText="Removing..."
						>
							Remove
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
