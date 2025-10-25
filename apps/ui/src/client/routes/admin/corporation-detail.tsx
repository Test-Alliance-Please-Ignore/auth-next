import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
	ArrowLeft,
	RefreshCw,
	Shield,
	ShieldCheck,
	ShieldAlert,
	Database,
	Users,
	Wallet,
	Package,
	TrendingUp,
	Skull,
	Building2,
	CheckCircle2,
	XCircle,
	MessageSquare,
	Save,
	X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DirectorList } from '@/components/DirectorList'
import {
	useCorporation,
	useUpdateCorporation,
	useVerifyCorporationAccess,
	useFetchCorporationData,
	useCorporationDataSummary,
} from '@/hooks/useCorporations'
import { useBreadcrumb } from '@/hooks/useBreadcrumb'
import { useMessage } from '@/hooks/useMessage'
import { formatDistanceToNow } from 'date-fns'
import type { UpdateCorporationRequest } from '@/lib/api'

export default function CorporationDetailPage() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const corpId = corporationId || ''

	const { data: corporation, isLoading } = useCorporation(corpId)
	const { data: dataSummary, isLoading: summaryLoading } = useCorporationDataSummary(corpId)
	const updateCorporation = useUpdateCorporation()
	const verifyAccess = useVerifyCorporationAccess()
	const fetchData = useFetchCorporationData()

	// Set breadcrumb
	const { setCustomLabel, clearCustomLabel } = useBreadcrumb()
	useEffect(() => {
		if (corporation) {
			setCustomLabel(`/admin/corporations/${corpId}`, corporation.name)
		}

		// Cleanup function to clear the breadcrumb label when component unmounts or corpId changes
		return () => {
			clearCustomLabel(`/admin/corporations/${corpId}`)
		}
	}, [corporation, corpId, setCustomLabel, clearCustomLabel])

	// Message handling with automatic cleanup
	const { message, showSuccess, showError } = useMessage()

	// Form state
	const [isEditing, setIsEditing] = useState(false)
	const [formData, setFormData] = useState<UpdateCorporationRequest>({})

	// Initialize form when editing starts
	useEffect(() => {
		if (corporation && isEditing) {
			setFormData({
				assignedCharacterId: corporation.assignedCharacterId || undefined,
				assignedCharacterName: corporation.assignedCharacterName || undefined,
				isActive: corporation.isActive,
				discordGuildId: corporation.discordGuildId || undefined,
				discordGuildName: corporation.discordGuildName || undefined,
				discordAutoInvite: corporation.discordAutoInvite,
			})
		} else if (!isEditing) {
			// Reset form when not editing
			setFormData({})
		}
	}, [corporation, isEditing])

	// Handlers
	const handleUpdate = async (e: React.FormEvent) => {
		e.preventDefault()
		try {
			await updateCorporation.mutateAsync({ corporationId: corpId, data: formData })
			setIsEditing(false)
			showSuccess('Corporation updated successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update corporation')
		}
	}

	const handleVerify = async () => {
		try {
			const result = await verifyAccess.mutateAsync(corpId)
			if (result.hasAccess) {
				showSuccess(`Access verified! Roles: ${result.verifiedRoles.join(', ')}`)
			} else {
				showError(`Verification failed. Missing roles: ${result.missingRoles?.join(', ') || 'Unknown'}`)
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to verify access')
		}
	}

	const handleFetch = async (category: string) => {
		try {
			await fetchData.mutateAsync({ corporationId: corpId, data: { category: category as any } })
			showSuccess(`Started fetching ${category} data...`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to fetch data')
		}
	}

	const formatDate = (date: string | null) => {
		if (!date) return 'Never'
		return formatDistanceToNow(new Date(date), { addSuffix: true })
	}

	if (isLoading) {
		return (
			<div className="flex justify-center py-12">
				<LoadingSpinner label="Loading corporation..." />
			</div>
		)
	}

	if (!corporation) {
		return (
			<div className="text-center py-12">
				<Building2 className="mx-auto h-12 w-12 text-muted-foreground" />
				<h3 className="mt-4 text-lg font-medium">Corporation not found</h3>
				<p className="text-muted-foreground mt-2">This corporation may have been removed.</p>
				<Button asChild className="mt-4">
					<Link to="/admin/corporations">
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back to Corporations
					</Link>
				</Button>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Back Button */}
			<Button variant="ghost" asChild>
				<Link to="/admin/corporations">
					<ArrowLeft className="mr-2 h-4 w-4" />
					Back to Corporations
				</Link>
			</Button>

			{/* Page Header */}
			<div className="flex items-start justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{corporation.name}</h1>
					<p className="text-muted-foreground mt-1">[{corporation.ticker}]</p>
				</div>
				<div className="flex gap-2">
					{corporation.assignedCharacterId && (
						<Button onClick={handleVerify} disabled={verifyAccess.isPending}>
							<Shield className="mr-2 h-4 w-4" />
							{verifyAccess.isPending ? 'Verifying...' : 'Verify Access'}
						</Button>
					)}
				</div>
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

			{/* Status Overview */}
			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Status</CardTitle>
						{corporation.isActive ? (
							<CheckCircle2 className="h-4 w-4 text-green-600" />
						) : (
							<XCircle className="h-4 w-4 text-muted-foreground" />
						)}
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{corporation.isActive ? 'Active' : 'Inactive'}</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Last Sync</CardTitle>
						<RefreshCw className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{formatDate(corporation.lastSync)}</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Verification</CardTitle>
						{corporation.isVerified ? (
							<ShieldCheck className="h-4 w-4 text-green-600" />
						) : (
							<ShieldAlert className="h-4 w-4 text-destructive" />
						)}
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{corporation.isVerified ? 'Verified' : 'Unverified'}
						</div>
						<p className="text-xs text-muted-foreground mt-1">
							{formatDate(corporation.lastVerified)}
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Tabs */}
			<Tabs defaultValue="config" className="space-y-4">
				<TabsList>
					<TabsTrigger value="config">Configuration</TabsTrigger>
					<TabsTrigger value="data">Data Summary</TabsTrigger>
					<TabsTrigger value="fetch">Fetch Data</TabsTrigger>
				</TabsList>

				{/* Configuration Tab */}
				<TabsContent value="config" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Directors</CardTitle>
							<CardDescription>
								Manage director characters with access to corporation data via ESI. Multiple directors provide automatic failover and load balancing.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<DirectorList corporationId={corpId} />
						</CardContent>
					</Card>

					{/* Discord Integration Card */}
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<div>
									<div className="flex items-center gap-2">
										<MessageSquare className="h-5 w-5 text-[hsl(var(--discord-blurple))]" />
										<CardTitle>Discord Integration</CardTitle>
									</div>
									<CardDescription>
										Configure Discord server auto-invite for corporation members. When enabled, users with linked Discord accounts will automatically be invited to join the corporation's Discord server.
									</CardDescription>
								</div>
								{!isEditing && (
									<Button onClick={() => setIsEditing(true)} variant="outline" size="sm">
										Edit
									</Button>
								)}
							</div>
						</CardHeader>
						<CardContent>
							{isEditing ? (
								<form onSubmit={handleUpdate} className="space-y-4">
									<div className="space-y-2">
										<Label htmlFor="discordGuildId">Discord Server/Guild ID</Label>
										<Input
											id="discordGuildId"
											type="text"
											placeholder="e.g., 1234567890123456789"
											value={formData.discordGuildId || ''}
											onChange={(e) =>
												setFormData({ ...formData, discordGuildId: e.target.value || null })
											}
										/>
										<p className="text-xs text-muted-foreground">
											Right-click the server in Discord → Copy Server ID (requires Developer Mode enabled)
										</p>
									</div>

									<div className="space-y-2">
										<Label htmlFor="discordGuildName">Discord Server Name (Optional)</Label>
										<Input
											id="discordGuildName"
											type="text"
											placeholder="e.g., My Corporation Server"
											value={formData.discordGuildName || ''}
											onChange={(e) =>
												setFormData({ ...formData, discordGuildName: e.target.value || null })
											}
										/>
										<p className="text-xs text-muted-foreground">
											Display name for the Discord server (shown to users)
										</p>
									</div>

									<div className="flex items-center space-x-2">
										<Switch
											id="discordAutoInvite"
											checked={formData.discordAutoInvite || false}
											onCheckedChange={(checked: boolean) =>
												setFormData({ ...formData, discordAutoInvite: checked })
											}
										/>
										<Label htmlFor="discordAutoInvite" className="cursor-pointer">
											Enable Auto-Invite
										</Label>
									</div>
									<p className="text-xs text-muted-foreground">
										When enabled, corporation members with linked Discord accounts can automatically join the server
									</p>

									<div className="flex gap-2 pt-2">
										<Button type="submit" disabled={updateCorporation.isPending}>
											<Save className="mr-2 h-4 w-4" />
											{updateCorporation.isPending ? 'Saving...' : 'Save Changes'}
										</Button>
										<Button
											type="button"
											variant="outline"
											onClick={() => setIsEditing(false)}
											disabled={updateCorporation.isPending}
										>
											<X className="mr-2 h-4 w-4" />
											Cancel
										</Button>
									</div>
								</form>
							) : (
								<div className="space-y-4">
									<div className="grid gap-4 md:grid-cols-2">
										<div>
											<p className="text-sm font-medium text-muted-foreground">Discord Server ID</p>
											<p className="text-sm">
												{corporation.discordGuildId || (
													<span className="text-muted-foreground italic">Not configured</span>
												)}
											</p>
										</div>
										<div>
											<p className="text-sm font-medium text-muted-foreground">Server Name</p>
											<p className="text-sm">
												{corporation.discordGuildName || (
													<span className="text-muted-foreground italic">Not set</span>
												)}
											</p>
										</div>
									</div>
									<div className="flex items-center gap-2">
										<p className="text-sm font-medium text-muted-foreground">Auto-Invite:</p>
										{corporation.discordAutoInvite ? (
											<span className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
												<CheckCircle2 className="h-4 w-4" />
												Enabled
											</span>
										) : (
											<span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
												<XCircle className="h-4 w-4" />
												Disabled
											</span>
										)}
									</div>
									{corporation.discordGuildId && corporation.discordAutoInvite && (
										<div className="rounded-lg bg-muted/50 p-3">
											<p className="text-sm text-muted-foreground">
												<strong>Note:</strong> The Discord bot must be added to this server with the "guilds.join" scope and "Create Instant Invite" permission for auto-invite to work.
											</p>
										</div>
									)}
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* Data Summary Tab */}
				<TabsContent value="data" className="space-y-4">
					{summaryLoading ? (
						<div className="flex justify-center py-8">
							<LoadingSpinner label="Loading data summary..." />
						</div>
					) : (
						<div className="grid gap-4 md:grid-cols-2">
							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="text-sm font-medium">Members</CardTitle>
									<Users className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="text-2xl font-bold">
										{dataSummary?.coreData?.memberCount || 0}
									</div>
									<p className="text-xs text-muted-foreground">
										{dataSummary?.coreData?.trackingCount || 0} with tracking data
									</p>
								</CardContent>
							</Card>

							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="text-sm font-medium">Wallets</CardTitle>
									<Wallet className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="text-2xl font-bold">
										{dataSummary?.financialData?.walletCount || 0}
									</div>
									<p className="text-xs text-muted-foreground">
										{dataSummary?.financialData?.journalCount || 0} journal entries
									</p>
								</CardContent>
							</Card>

							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="text-sm font-medium">Assets</CardTitle>
									<Package className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="text-2xl font-bold">
										{dataSummary?.assetsData?.assetCount || 0}
									</div>
									<p className="text-xs text-muted-foreground">
										{dataSummary?.assetsData?.structureCount || 0} structures
									</p>
								</CardContent>
							</Card>

							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="text-sm font-medium">Market</CardTitle>
									<TrendingUp className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="text-2xl font-bold">
										{dataSummary?.marketData?.orderCount || 0}
									</div>
									<p className="text-xs text-muted-foreground">
										{dataSummary?.marketData?.contractCount || 0} contracts
									</p>
								</CardContent>
							</Card>

							<Card>
								<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
									<CardTitle className="text-sm font-medium">Killmails</CardTitle>
									<Skull className="h-4 w-4 text-muted-foreground" />
								</CardHeader>
								<CardContent>
									<div className="text-2xl font-bold">{dataSummary?.killmailCount || 0}</div>
									<p className="text-xs text-muted-foreground">Recent killmails</p>
								</CardContent>
							</Card>
						</div>
					)}
				</TabsContent>

				{/* Fetch Data Tab */}
				<TabsContent value="fetch" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Fetch Corporation Data</CardTitle>
							<CardDescription>
								Trigger data fetches from EVE ESI. Requires assigned director with proper roles.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="grid gap-3">
								<Button
									onClick={() => handleFetch('all')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Database className="mr-2 h-4 w-4" />
									Fetch All Data
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('public')}
									disabled={fetchData.isPending}
									className="w-full justify-start"
								>
									<Building2 className="mr-2 h-4 w-4" />
									Fetch Public Data
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('core')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Users className="mr-2 h-4 w-4" />
									Fetch Members & Tracking
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('financial')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Wallet className="mr-2 h-4 w-4" />
									Fetch Financial Data
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('assets')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Package className="mr-2 h-4 w-4" />
									Fetch Assets & Structures
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('market')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<TrendingUp className="mr-2 h-4 w-4" />
									Fetch Market Data
								</Button>
								<Button
									variant="outline"
									onClick={() => handleFetch('killmails')}
									disabled={fetchData.isPending || !corporation.assignedCharacterId}
									className="w-full justify-start"
								>
									<Skull className="mr-2 h-4 w-4" />
									Fetch Killmails
								</Button>
							</div>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	)
}
