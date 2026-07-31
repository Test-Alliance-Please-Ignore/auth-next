import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Lock, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { Link } from 'react-router'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/hooks/useAuth'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { apiClient, type PasteSettings } from '@/lib/api'
import toast from '@/lib/toast'

function toStartOfDayIso(dateOnly: string): string | undefined {
	if (!dateOnly) return undefined
	return new Date(`${dateOnly}T00:00:00.000Z`).toISOString()
}

function toEndOfDayIso(dateOnly: string): string | undefined {
	if (!dateOnly) return undefined
	return new Date(`${dateOnly}T23:59:59.999Z`).toISOString()
}

export default function AdminPastesPage() {
	usePageTitle('Admin - Pastes')

	const { user, isLoading } = useAuth()
	const queryClient = useQueryClient()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const [settings, setSettings] = useState<PasteSettings | null>(null)
	const [visibility, setVisibility] = useState<'all' | 'alliance' | 'public'>('all')
	const [creatorQuery, setCreatorQuery] = useState('')
	const [creatorUserId, setCreatorUserId] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)
	const [createdRange, setCreatedRange] = useState({ fromDate: '', toDate: '' })
	const [expiresRange, setExpiresRange] = useState({ fromDate: '', toDate: '' })
	const [copiedPasteId, setCopiedPasteId] = useState<string | null>(null)

	const creatorUsersQuery = useQuery({
		queryKey: ['admin', 'pastes', 'creator-search', creatorQuery],
		queryFn: () => apiClient.getAdminUsers({ search: creatorQuery, page: 1, pageSize: 25 }),
		enabled: !!user?.is_admin && creatorQuery.trim().length > 1,
	})

	const listQuery = useQuery({
		queryKey: [
			'admin',
			'pastes',
			'list',
			visibility,
			creatorUserId,
			page,
			pageSize,
			createdRange.fromDate,
			createdRange.toDate,
			expiresRange.fromDate,
			expiresRange.toDate,
		],
		queryFn: () =>
			apiClient.getAdminPastes({
				limit: pageSize,
				offset: (page - 1) * pageSize,
				visibility: visibility === 'all' ? undefined : visibility,
				creatorUserId: creatorUserId || undefined,
				createdFrom: toStartOfDayIso(createdRange.fromDate),
				createdTo: toEndOfDayIso(createdRange.toDate),
				expiresFrom: toStartOfDayIso(expiresRange.fromDate),
				expiresTo: toEndOfDayIso(expiresRange.toDate),
			}),
		placeholderData: (previousData) => previousData,
		enabled: !!user?.is_admin,
	})

	const settingsQuery = useQuery({
		queryKey: ['admin', 'pastes', 'settings'],
		queryFn: () => apiClient.getPasteSettings(),
		enabled: !!user?.is_admin,
	})

	useEffect(() => {
		if (settingsQuery.data) setSettings(settingsQuery.data)
	}, [settingsQuery.data])

	const saveSettingsMutation = useMutation({
		mutationFn: (payload: NonNullable<typeof settings>) =>
			apiClient.updatePasteSettings({
				createRateLimitCount: payload.createRateLimitCount,
				createRateLimitWindowMinutes: payload.createRateLimitWindowMinutes,
				maxActivePastesPerUser: payload.maxActivePastesPerUser,
			}),
		onSuccess: () => {
			toast.success('Paste settings saved')
			void queryClient.invalidateQueries({ queryKey: ['admin', 'pastes', 'settings'] })
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Failed to save settings')
		},
	})

	const deleteMutation = useMutation({
		mutationFn: (id: string) => apiClient.adminDeletePaste(id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['admin', 'pastes', 'list'] })
		},
		onError: (error) => toast.error(error instanceof Error ? error.message : 'Delete failed'),
	})

	const requestDeletePaste = (pasteId: string) => {
		requestConfirmation({
			title: 'Delete Paste?',
			description: 'This will permanently delete the paste and its stored content. This cannot be undone.',
			confirmLabel: 'Delete',
			intent: 'destructive',
			onConfirm: async () => {
				await deleteMutation.mutateAsync(pasteId)
			},
		})
	}

	const handleCopyPasteUrl = async (pasteId: string) => {
		const url = `${window.location.origin}/paste/${pasteId}`
		try {
			await navigator.clipboard.writeText(url)
			setCopiedPasteId(pasteId)
			toast.success('Paste URL copied')
			setTimeout(() => {
				setCopiedPasteId((current) => (current === pasteId ? null : current))
			}, 1200)
		} catch {
			toast.error('Failed to copy paste URL')
		}
	}

	if (isLoading) return null
	if (!user?.is_admin) return <Navigate to="/dashboard" replace />

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
			<h1 className="text-2xl font-semibold">Admin Pastes</h1>
			<Card className="text-sm">
				<CardHeader>
					<CardTitle>Settings</CardTitle>
				</CardHeader>
				<CardContent>
				{settings ? (
					<div className="grid gap-3 md:grid-cols-3">
						<div>
							<Label>New pastes per window/user</Label>
							<Input
								type="number"
								value={settings.createRateLimitCount}
								onChange={(e) =>
									setSettings((prev) =>
										prev ? { ...prev, createRateLimitCount: Number(e.target.value) || 1 } : prev
									)
								}
							/>
						</div>
						<div>
							<Label>Window minutes</Label>
							<Input
								type="number"
								value={settings.createRateLimitWindowMinutes}
								onChange={(e) =>
									setSettings((prev) =>
										prev
											? { ...prev, createRateLimitWindowMinutes: Number(e.target.value) || 1 }
											: prev
									)
								}
							/>
						</div>
						<div>
							<Label>Max active pastes/user</Label>
							<Input
								type="number"
								value={settings.maxActivePastesPerUser}
								onChange={(e) =>
									setSettings((prev) =>
										prev ? { ...prev, maxActivePastesPerUser: Number(e.target.value) || 1 } : prev
									)
								}
							/>
						</div>
						<div className="md:col-span-3 flex justify-end">
							<Button
								onClick={() => settings && saveSettingsMutation.mutate(settings)}
								disabled={saveSettingsMutation.isPending}
							>
								{saveSettingsMutation.isPending ? 'Saving...' : 'Save Settings'}
							</Button>
						</div>
					</div>
				) : (
					<p>Loading settings...</p>
				)}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>All Pastes</CardTitle>
				</CardHeader>
				<CardContent>
				<div className="mb-2 grid gap-3 md:grid-cols-4">
					<div>
						<Label>Creator</Label>
						<Select
							value={creatorUserId}
							onValueChange={setCreatorUserId}
							query={creatorQuery}
							onQueryChange={setCreatorQuery}
							options={[
								{ value: '', label: 'All creators' },
								...(creatorUsersQuery.data?.data ?? []).map((user) => ({
									value: user.id,
									label: `${user.mainCharacterName ?? 'Unknown'} (${user.id.slice(0, 8)})`,
								})),
							]}
							placeholder="All creators"
						/>
					</div>
					<div>
						<Label>Visibility</Label>
						<Select
							value={visibility}
							onValueChange={(value) => setVisibility(value as 'all' | 'alliance' | 'public')}
							options={[
								{ value: 'all', label: 'All' },
								{ value: 'alliance', label: 'Alliance' },
								{ value: 'public', label: 'Public' },
							]}
						/>
					</div>
					<div>
						<Label>Created</Label>
						<DateRangeInput value={createdRange} onChange={setCreatedRange} />
					</div>
					<div>
						<Label>Expires</Label>
						<DateRangeInput value={expiresRange} onChange={setExpiresRange} />
					</div>
				</div>
				<div className="mb-4 flex justify-end">
					<Button
						variant="secondary"
						onClick={() => {
							setCreatorQuery('')
							setCreatorUserId('')
							setVisibility('all')
							setCreatedRange({ fromDate: '', toDate: '' })
							setExpiresRange({ fromDate: '', toDate: '' })
							setPage(1)
						}}
					>
						Clear Filters
					</Button>
				</div>
				<UserSearchPaginationControls
					totalCount={listQuery.data?.total ?? 0}
					page={page}
					pageSize={pageSize}
					onPageChange={setPage}
					onPageSizeChange={(size) => {
						setPageSize(size)
						setPage(1)
					}}
					itemLabel="pastes"
				/>
				<div className="rounded-md border bg-card">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>ID</TableHead>
								<TableHead>Name</TableHead>
								<TableHead>Creator</TableHead>
								<TableHead>Visibility</TableHead>
								<TableHead>Created</TableHead>
								<TableHead>Expires</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(listQuery.data?.items ?? []).length === 0 ? (
								<TableRow>
									<TableCell colSpan={7} className="text-center text-muted-foreground">
										No pastes found.
									</TableCell>
								</TableRow>
							) : (
								(listQuery.data?.items ?? []).map((paste) => (
									<TableRow key={paste.id}>
										<TableCell>
											<div className="flex items-center gap-2">
												<Button
													variant="ghost"
													size="icon"
													className="relative h-7 w-7"
													onClick={() => void handleCopyPasteUrl(paste.id)}
													aria-label={`Copy URL for paste ${paste.id}`}
													title="Copy paste URL"
												>
													<Copy
														className={`h-3.5 w-3.5 transition-opacity ${
															copiedPasteId === paste.id ? 'opacity-0' : 'opacity-100'
														}`}
													/>
													<Check
														className={`absolute h-3.5 w-3.5 text-green-500 transition-opacity ${
															copiedPasteId === paste.id ? 'opacity-100' : 'opacity-0'
														}`}
													/>
												</Button>
												<Link className="font-mono underline" to={`/paste/${paste.id}`}>
													{paste.id}
												</Link>
											</div>
										</TableCell>
										<TableCell>
											<Link className="underline" to={`/paste/${paste.id}`}>
												{paste.name}
											</Link>
										</TableCell>
										<TableCell>
											{paste.creatorDisplayName ?? paste.createdByCharacterName ?? paste.createdByUserId}
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-1 capitalize">
												<span>{paste.visibility}</span>
												{paste.isPasswordProtected ? (
													<Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Password protected" />
												) : null}
											</div>
										</TableCell>
										<TableCell>{new Date(paste.createdAt).toLocaleString()}</TableCell>
										<TableCell>
											{paste.expiresAt ? new Date(paste.expiresAt).toLocaleString() : 'indefinite'}
										</TableCell>
										<TableCell className="text-right">
											<Button
												size="icon"
												variant="ghost"
												onClick={() => requestDeletePaste(paste.id)}
												disabled={deleteMutation.isPending}
												aria-label={`Delete paste ${paste.id}`}
												title="Delete paste"
											>
												<Trash2 className="h-4 w-4 text-destructive" />
											</Button>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
				<div className="mt-4 border-t pt-4">
					<UserSearchPaginationControls
						totalCount={listQuery.data?.total ?? 0}
						page={page}
						pageSize={pageSize}
						onPageChange={setPage}
						onPageSizeChange={(size) => {
							setPageSize(size)
							setPage(1)
						}}
						itemLabel="pastes"
					/>
				</div>
				</CardContent>
			</Card>
			{confirmationDialog}
		</div>
	)
}
