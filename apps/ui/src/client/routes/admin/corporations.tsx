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
import { useAppTranslation } from '@/i18n'
import { formatRelativeTime } from '@/lib/date-utils'

import type { FormEvent } from 'react'
import type { CorporationsFilters, CreateCorporationRequest } from '@/lib/api'

export default function CorporationsPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('admin.organizations.corp.pageTitle'))

	// Filter state
	const [filters, setFilters] = useState<CorporationsFilters>({
		corporationType: 'member',
		search: undefined,
		page: 1,
		pageSize: 25,
	})
	const [searchQuery, setSearchQuery] = useState('')

	useEffect(() => {
		const timer = setTimeout(() => {
			const search = searchQuery.trim() || undefined
			setFilters((current) => {
				if (current.search === search && current.page === 1) return current
				return { ...current, search, page: 1 }
			})
		}, 300)

		return () => clearTimeout(timer)
	}, [searchQuery])

	const { data, isLoading, isFetching, error } = useCorporations(filters)
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
		setFilters({
			corporationType: 'member',
			search: undefined,
			page: 1,
			pageSize: filters.pageSize ?? 25,
		})
	}

	const handlePageSizeChange = (pageSize: number) => {
		if (pageSize !== 25 && pageSize !== 50 && pageSize !== 100) return
		setFilters((current) => ({ ...current, page: 1, pageSize }))
	}

	// Handlers
	const handleCreate = async (e: FormEvent) => {
		e.preventDefault()

		// Validate corporation ID is a valid number
		if (!formData.corporationId) {
			showError((t) => t('admin.organizations.feedback.corpIdInvalid'))
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
			showSuccess((t) => t('admin.organizations.feedback.corpAdded'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.corpAddError')
			)
		}
	}

	const handleDelete = async () => {
		if (!selectedCorpId) return
		try {
			await deleteCorporation.mutateAsync(selectedCorpId)
			setDeleteDialogOpen(false)
			setSelectedCorpId(null)
			showSuccess((t) => t('admin.organizations.feedback.corpRemoved'))
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.corpRemoveError')
			)
		}
	}

	const handleVerify = async (corporationId: string) => {
		try {
			const result = await verifyAccess.mutateAsync(corporationId)
			if (result.hasAccess) {
				showSuccess((t) => t('admin.organizations.feedback.accessVerified'))
			} else {
				showError((t) => t('admin.organizations.feedback.accessMissing'))
			}
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.accessError')
			)
		}
	}

	const handleToggleBackgroundRefresh = async (corporationId: string, enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId,
				data: { includeInBackgroundRefresh: enabled },
			})
			showSuccess((t) =>
				t(
					enabled
						? 'admin.organizations.feedback.backgroundEnabled'
						: 'admin.organizations.feedback.backgroundDisabled'
				)
			)
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.settingError')
			)
		}
	}

	const handleToggleStructureAssetSync = async (corporationId: string, enabled: boolean) => {
		try {
			await updateCorporation.mutateAsync({
				corporationId,
				data: { includeInStructureAssetSync: enabled },
			})
			showSuccess((t) =>
				t(
					enabled
						? 'admin.organizations.feedback.assetsEnabled'
						: 'admin.organizations.feedback.assetsDisabled'
				)
			)
		} catch (error) {
			showError((t) =>
				error instanceof Error ? error.message : t('admin.organizations.feedback.settingError')
			)
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
					{t('admin.organizations.corp.verified')}
				</Badge>
			)
		}
		return (
			<Badge variant="destructive" className="gap-1">
				<ShieldAlert className="h-3 w-3" />
				{t('admin.organizations.corp.unverified')}
			</Badge>
		)
	}, [])

	// Format date (memoized for performance)
	const formatDate = useCallback(
		(date: string | null) => {
			if (!date) return t('admin.users.account.never')
			const parsedDate = new Date(date)
			if (Number.isNaN(parsedDate.getTime())) return t('admin.users.account.never')
			return formatRelativeTime(parsedDate)
		},
		[t]
	)

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{t('admin.nav.corporations')}</h1>
					<p className="text-muted-foreground mt-1">{t('admin.organizations.corp.description')}</p>
				</div>
				<Button onClick={() => setCreateDialogOpen(true)}>
					<Plus className="h-4 w-4" />
					{t('admin.organizations.corp.add')}
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
							<CardTitle>{t('admin.organizations.corp.searchFilters')}</CardTitle>
							<CardDescription>{t('admin.organizations.corp.filterDescription')}</CardDescription>
						</div>
						{hasActiveFilters && (
							<Button variant="ghost" size="sm" onClick={clearFilters}>
								<X className="h-4 w-4" />
								{t('groups.clearFilters')}
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
								placeholder={t('admin.organizations.corp.searchPlaceholder')}
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9"
							/>
						</div>

						{/* Filters */}
						<div className="flex gap-4">
							<div className="flex-1 space-y-2">
								<Label htmlFor="corporation-type-filter">
									{t('admin.organizations.corp.type')}
								</Label>
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
										{ value: 'all', label: t('admin.organizations.corp.all') },
										{ value: 'member', label: t('admin.organizations.corp.memberCorps') },
										{ value: 'alt', label: t('admin.organizations.corp.altCorps') },
										{ value: 'special', label: t('admin.organizations.corp.specialCorps') },
										{ value: 'other', label: t('admin.organizations.corp.otherCorps') },
									]}
									placeholder={t('admin.organizations.corp.all')}
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
							<CardTitle>
								{t('admin.organizations.corp.managed', { count: pagination?.totalCount ?? 0 })}
							</CardTitle>
							<CardDescription>{t('admin.organizations.corp.managedDescription')}</CardDescription>
						</div>
						<UserSearchPaginationControls
							totalCount={pagination?.totalCount ?? 0}
							page={filters.page ?? 1}
							pageSize={filters.pageSize ?? 25}
							onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
							onPageSizeChange={handlePageSizeChange}
							itemLabel={t('admin.nav.corporations')}
							nextButtonLoading={isFetching}
						/>
					</div>
				</CardHeader>
				<CardContent>
					<TableRefreshFrame
						isRefreshing={isSoftLoading}
						refreshMessage={t('admin.organizations.corp.loading')}
						errorMessage={
							error && data
								? error instanceof Error
									? error.message
									: t('admin.organizations.corp.refreshError')
								: null
						}
					>
						{error && !data ? (
							<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-8 text-center text-sm text-destructive">
								<div className="font-medium">{t('admin.organizations.corp.loadError')}</div>
								<div className="mt-1 text-destructive/80">
									{error instanceof Error ? error.message : t('admin.organizations.corp.retry')}
								</div>
							</div>
						) : isInitialLoading ? (
							<div className="flex justify-center py-8">
								<LoadingSpinner label={t('admin.organizations.corp.loading')} />
							</div>
						) : corporations.length === 0 ? (
							<div className="text-center py-8">
								<Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
								<h3 className="mt-4 text-lg font-medium">{t('admin.organizations.corp.empty')}</h3>
								<p className="text-muted-foreground mt-2">
									{searchQuery
										? t('admin.organizations.corp.searchHint')
										: t('admin.organizations.corp.firstHint')}
								</p>
							</div>
						) : (
							<>
								<div className="rounded-md border bg-card">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>{t('admin.users.account.corporation')}</TableHead>
												<TableHead>{t('admin.organizations.corp.directors')}</TableHead>
												<TableHead>{t('admin.users.account.status')}</TableHead>
												<TableHead>{t('admin.organizations.corp.autoSync')}</TableHead>
												<TableHead>{t('admin.organizations.corp.assetSync')}</TableHead>
												<TableHead>{t('admin.organizations.corp.lastSync')}</TableHead>
												<TableHead>{t('admin.organizations.corp.lastVerified')}</TableHead>
												<TableHead className="text-right">{t('admin.fields.actions')}</TableHead>
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
															<div>
																{t('admin.organizations.corp.healthyCount', {
																	count: corp.healthyDirectorCount,
																})}
															</div>
															{corp.healthyDirectorCount === 0 && (
																<div className="text-amber-600 text-xs">
																	{t('admin.organizations.corp.needsVerification')}
																</div>
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
																	title={t('admin.organizations.corp.verifyHint')}
																	aria-label={t('admin.organizations.corp.verifyHint')}
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
											itemLabel={t('admin.nav.corporations')}
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
						<DialogTitle>{t('admin.organizations.corp.add')}</DialogTitle>
						<DialogDescription>{t('admin.organizations.corp.addDescription')}</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleCreate}>
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="corporationId">{t('admin.organizations.corp.idRequired')}</Label>
								<Input
									id="corporationId"
									type="text"
									inputMode="numeric"
									pattern="[0-9]*"
									value={formData.corporationId}
									onChange={(e) => setFormData({ ...formData, corporationId: e.target.value })}
									required
									placeholder={t('admin.organizations.corp.idExample')}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="name">{t('admin.organizations.corp.nameRequired')}</Label>
								<Input
									id="name"
									value={formData.name}
									onChange={(e) => setFormData({ ...formData, name: e.target.value })}
									required
									placeholder={t('admin.organizations.corp.nameExample')}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="ticker">{t('admin.organizations.corp.tickerRequired')}</Label>
								<Input
									id="ticker"
									value={formData.ticker}
									onChange={(e) => setFormData({ ...formData, ticker: e.target.value })}
									required
									placeholder={t('admin.organizations.corp.tickerExample')}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="characterId">{t('admin.organizations.corp.directorId')}</Label>
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
									placeholder={t('admin.organizations.directors.characterIdExample')}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="characterName">{t('admin.organizations.corp.directorName')}</Label>
								<Input
									id="characterName"
									value={formData.assignedCharacterName || ''}
									onChange={(e) =>
										setFormData({ ...formData, assignedCharacterName: e.target.value || undefined })
									}
									placeholder={t('admin.organizations.corp.characterExample')}
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
										{t('admin.organizations.corp.backgroundRefresh')}
									</Label>
								</div>
								<p className="text-sm text-muted-foreground">
									{t('admin.organizations.corp.backgroundHint')}
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
										{t('admin.organizations.corp.structureSync')}
									</Label>
								</div>
								<p className="text-sm text-muted-foreground">
									{t('admin.organizations.corp.structureHint')}
								</p>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<Button variant="cancel" type="button" onClick={() => setCreateDialogOpen(false)}>
								{t('common.cancel')}
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={createCorporation.isPending}
								loadingText={t('admin.organizations.corp.adding')}
							>
								{t('admin.organizations.corp.add')}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.organizations.corp.remove')}</DialogTitle>
						<DialogDescription>{t('admin.organizations.corp.removeWarning')}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteDialogOpen(false)}>
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
							loading={deleteCorporation.isPending}
							loadingText={t('admin.users.account.removing')}
						>
							{t('common.remove')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
