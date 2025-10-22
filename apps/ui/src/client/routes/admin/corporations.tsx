import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Shield, ShieldAlert, ShieldCheck, RefreshCw, Building2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/ui/loading'
import {
	useCorporations,
	useCreateCorporation,
	useDeleteCorporation,
	useVerifyCorporationAccess,
} from '@/hooks/useCorporations'
import { formatDistanceToNow } from 'date-fns'
import type { CreateCorporationRequest } from '@/lib/api'

export default function CorporationsPage() {
	const { data: corporations, isLoading } = useCorporations()
	const createCorporation = useCreateCorporation()
	const deleteCorporation = useDeleteCorporation()
	const verifyAccess = useVerifyCorporationAccess()

	// Dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedCorpId, setSelectedCorpId] = useState<number | null>(null)

	// Form state
	const [formData, setFormData] = useState<CreateCorporationRequest>({
		corporationId: 0,
		name: '',
		ticker: '',
		assignedCharacterId: undefined,
		assignedCharacterName: undefined,
	})

	// Search state
	const [searchQuery, setSearchQuery] = useState('')

	// Error/success messages
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Filter corporations by search
	const filteredCorporations = corporations?.filter(
		(corp) =>
			corp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			corp.ticker.toLowerCase().includes(searchQuery.toLowerCase())
	)

	// Handlers
	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault()
		try {
			await createCorporation.mutateAsync(formData)
			setCreateDialogOpen(false)
			setFormData({
				corporationId: 0,
				name: '',
				ticker: '',
				assignedCharacterId: undefined,
				assignedCharacterName: undefined,
			})
			setMessage({ type: 'success', text: 'Corporation added successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to add corporation',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDelete = async () => {
		if (!selectedCorpId) return
		try {
			await deleteCorporation.mutateAsync(selectedCorpId)
			setDeleteDialogOpen(false)
			setSelectedCorpId(null)
			setMessage({ type: 'success', text: 'Corporation removed successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to remove corporation',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleVerify = async (corporationId: number) => {
		try {
			const result = await verifyAccess.mutateAsync(corporationId)
			if (result.hasAccess) {
				setMessage({ type: 'success', text: 'Access verified successfully!' })
			} else {
				setMessage({ type: 'error', text: 'Verification failed: Missing required roles' })
			}
			setTimeout(() => setMessage(null), 5000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to verify access',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const openDeleteDialog = (corporationId: number) => {
		setSelectedCorpId(corporationId)
		setDeleteDialogOpen(true)
	}

	// Get verification status badge
	const getVerificationBadge = (corp: any) => {
		if (!corp.assignedCharacterId) {
			return (
				<Badge variant="outline" className="gap-1">
					<ShieldAlert className="h-3 w-3" />
					No Director
				</Badge>
			)
		}
		if (corp.isVerified) {
			return (
				<Badge variant="default" className="gap-1 bg-green-600">
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
	}

	// Format date
	const formatDate = (date: string | null) => {
		if (!date) return 'Never'
		return formatDistanceToNow(new Date(date), { addSuffix: true })
	}

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
					<Plus className="mr-2 h-4 w-4" />
					Add Corporation
				</Button>
			</div>

			{/* Success/Error Message */}
			{message && (
				<Card
					className={
						message.type === 'error' ? 'border-destructive bg-destructive/10' : 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Search */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Search</CardTitle>
					<CardDescription>Search by corporation name or ticker</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex gap-2">
						<div className="relative flex-1">
							<Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Search corporations..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9"
							/>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Corporations Table */}
			<Card>
				<CardHeader>
					<CardTitle>Managed Corporations ({filteredCorporations?.length || 0})</CardTitle>
					<CardDescription>Corporations configured for data collection</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex justify-center py-8">
							<LoadingSpinner label="Loading corporations..." />
						</div>
					) : !filteredCorporations || filteredCorporations.length === 0 ? (
						<div className="text-center py-8">
							<Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
							<h3 className="mt-4 text-lg font-medium">No corporations found</h3>
							<p className="text-muted-foreground mt-2">
								{searchQuery ? 'Try adjusting your search' : 'Add your first corporation to get started'}
							</p>
						</div>
					) : (
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Corporation</TableHead>
										<TableHead>Directors</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Last Sync</TableHead>
										<TableHead>Last Verified</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredCorporations.map((corp) => (
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
												{corp.healthyDirectorCount > 0 || corp.assignedCharacterId ? (
													<div className="text-sm">
														<div>
															{corp.healthyDirectorCount > 0
																? `${corp.healthyDirectorCount} healthy`
																: corp.assignedCharacterName || '1 director'}
														</div>
														{corp.healthyDirectorCount === 0 && corp.assignedCharacterId && (
															<div className="text-amber-600 text-xs">Needs verification</div>
														)}
													</div>
												) : (
													<span className="text-muted-foreground text-sm">No directors</span>
												)}
											</TableCell>
											<TableCell>{getVerificationBadge(corp)}</TableCell>
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
					)}
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
									type="number"
									value={formData.corporationId || ''}
									onChange={(e) =>
										setFormData({ ...formData, corporationId: Number.parseInt(e.target.value) || 0 })
									}
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
									type="number"
									value={formData.assignedCharacterId || ''}
									onChange={(e) =>
										setFormData({
											...formData,
											assignedCharacterId: Number.parseInt(e.target.value) || undefined,
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
						</div>
						<DialogFooter className="mt-6">
							<Button type="button" variant="ghost" onClick={() => setCreateDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={createCorporation.isPending}>
								{createCorporation.isPending ? 'Adding...' : 'Add Corporation'}
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
						<Button variant="ghost" onClick={() => setDeleteDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
							disabled={deleteCorporation.isPending}
						>
							{deleteCorporation.isPending ? 'Removing...' : 'Remove'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
