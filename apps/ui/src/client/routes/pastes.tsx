import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HoverPopover } from '@/components/ui/hover-popover'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { apiClient } from '@/lib/api'
import toast from '@/lib/toast'

const EXPIRATION_OPTIONS: Array<{ label: string; value: number | 'indefinite' }> = [
	{ label: '1 hour', value: 60 },
	{ label: '3 hours', value: 180 },
	{ label: '6 hours', value: 360 },
	{ label: '12 hours', value: 720 },
	{ label: '1 day', value: 1440 },
	{ label: '3 days', value: 4320 },
	{ label: '7 days', value: 10080 },
	{ label: '14 days', value: 20160 },
	{ label: '30 days', value: 43200 },
	{ label: 'Indefinite', value: 'indefinite' },
]

type ExpirationValue = number | 'indefinite'
const PASSWORD_PATTERN =
	/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*_\-+=,.?/|~`:])[A-Za-z0-9!@#$%^&*_\-+=,.?/|~`:]{8,128}$/

function getPasswordValidationError(password: string): string | null {
	if (!password.trim()) return 'Password is required.'
	if (!PASSWORD_PATTERN.test(password)) {
		return 'Password must be at least 8 characters, include upper/lowercase letters, a number, and a symbol: ! @ # $ % ^ & * - _ = + , . ? / | ~ ` :'
	}
	return null
}

function getPasswordChecks(password: string) {
	return [
		{ label: 'At least 8 characters', valid: password.length >= 8 },
		{ label: 'Uppercase letter', valid: /[A-Z]/.test(password) },
		{ label: 'Lowercase letter', valid: /[a-z]/.test(password) },
		{ label: 'Number', valid: /\d/.test(password) },
		{
			label: 'At least one symbol from: ! @ # $ % ^ & * - _ = + , . ? / | ~ ` :',
			valid: /[!@#$%^&*_\-+=,.?/|~`:]/.test(password),
		},
	]
}

export default function PastesPage() {
	const { isAuthenticated } = useAuth()
	const queryClient = useQueryClient()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const [name, setName] = useState('')
	const [content, setContent] = useState('')
	const [isPublic, setIsPublic] = useState(false)
	const [isPasswordProtected, setIsPasswordProtected] = useState(false)
	const [password, setPassword] = useState('')
	const [expiration, setExpiration] = useState<ExpirationValue>(60)
	const [copiedPasteId, setCopiedPasteId] = useState<string | null>(null)
	const [showPasswordValidationError, setShowPasswordValidationError] = useState(false)
	const passwordRequired = isPasswordProtected
	const passwordError = passwordRequired ? getPasswordValidationError(password) : null
	const passwordChecks = getPasswordChecks(password)

	const handleVisibilityChange = (nextPublic: boolean) => {
		setIsPublic(nextPublic)
		if (nextPublic) {
			setIsPasswordProtected(true)
		}
	}

	useEffect(() => {
		if (!passwordRequired) {
			setShowPasswordValidationError(false)
		}
	}, [passwordRequired])

	const mineQuery = useQuery({
		queryKey: ['pastes', 'mine'],
		queryFn: () => apiClient.getMyPastes(),
		enabled: isAuthenticated,
	})

	const createMutation = useMutation({
		mutationFn: () =>
			apiClient.createPaste({
				name,
				content,
				visibility: isPublic ? 'public' : 'alliance',
				expiration,
				password: isPasswordProtected ? password : undefined,
			}),
		onSuccess: () => {
			setName('')
			setContent('')
			setPassword('')
			setShowPasswordValidationError(false)
			setIsPublic(false)
			setIsPasswordProtected(false)
			void queryClient.invalidateQueries({ queryKey: ['pastes', 'mine'] })
			toast.success('Paste created')
		},
		onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to create paste'),
	})

	const deleteMutation = useMutation({
		mutationFn: (id: string) => apiClient.deletePaste(id),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pastes', 'mine'] }),
		onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to delete paste'),
	})

	const rows = mineQuery.data?.items ?? []
	const expirationOptions = useMemo(
		() =>
			EXPIRATION_OPTIONS.map((option) => ({
				value: option.value,
				label: option.label,
			})),
		[]
	)

	if (!isAuthenticated) return <Navigate to="/" replace />

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

	const requestDeletePaste = (pasteId: string, pasteName: string) => {
		requestConfirmation({
			title: 'Delete Paste?',
			description: `This will permanently delete "${pasteName}".`,
			confirmLabel: 'Delete',
			intent: 'destructive',
			onConfirm: async () => {
				await deleteMutation.mutateAsync(pasteId)
			},
		})
	}

	return (
		<Container className="space-y-6">
			<PageHeader title="Pastes" description="Create, manage, and share plaintext pastes." />
			<Card>
				<CardHeader>
					<CardTitle>Create Paste</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="mb-4 grid gap-4">
						<div className="md:col-span-2">
							<Label>Name</Label>
							<Input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Paste name"
								className="mt-1"
							/>
						</div>
						<div className="grid gap-4 md:grid-cols-[1fr_3.5fr_0.5fr_1fr_3.5fr] md:items-start">
							<div>
								<Label>Visibility</Label>
								<div className="mt-1 flex h-10 items-center gap-2 px-1">
									<span className="min-w-14 text-sm">{isPublic ? 'Public' : 'Alliance'}</span>
									<Switch checked={isPublic} onCheckedChange={handleVisibilityChange} />
								</div>
							</div>
							<div>
								<Label>Expiration</Label>
								<Select
									className="mt-1"
									value={String(expiration)}
									onValueChange={(value) =>
										setExpiration(value === 'indefinite' ? 'indefinite' : Number(value))
									}
									options={expirationOptions.map((option) => ({
										value: String(option.value),
										label: option.label,
									}))}
								/>
							</div>
							<div aria-hidden="true" />
							<div className={isPublic ? 'opacity-60' : undefined} aria-disabled={isPublic}>
								<Label>Password Protect</Label>
								<div className="mt-1 flex h-10 items-center px-1">
									<Switch
										checked={isPasswordProtected}
										onCheckedChange={setIsPasswordProtected}
										disabled={isPublic}
									/>
								</div>
							</div>
							<div>
								<Label>
									Password {passwordRequired ? null : '(optional)'}
									{passwordRequired ? <span className="ml-1 text-destructive">*</span> : null}
								</Label>
								<div className="mt-1">
									{passwordRequired ? (
										<HoverPopover
											trigger={
												<div>
													<Input
														value={password}
														onChange={(e) => setPassword(e.target.value)}
														type="password"
														disabled={!isPasswordProtected}
														className={
															showPasswordValidationError && passwordError
																? 'border-destructive focus-visible:ring-destructive'
																: ''
														}
													/>
												</div>
											}
											align="start"
											className="w-80 border border-destructive/60"
											fullWidth
										>
											<div className="space-y-1 text-xs">
												{passwordChecks.map((check) => (
													<div
														key={check.label}
														className={check.valid ? 'text-green-500' : 'text-destructive'}
													>
														{check.valid ? '✓' : '✕'} {check.label}
													</div>
												))}
											</div>
										</HoverPopover>
									) : (
										<Input
											value={password}
											onChange={(e) => setPassword(e.target.value)}
											type="password"
											disabled={!isPasswordProtected}
										/>
									)}
								</div>
								<p className="mt-1 text-xs text-muted-foreground">
									Password-protected pastes cannot be recovered if password is lost.
								</p>
							</div>
						</div>
					</div>
					<div className="mb-4">
						<Label>Content</Label>
						<Textarea
							value={content}
							onChange={(e) => setContent(e.target.value)}
							rows={10}
							placeholder="Paste plaintext content..."
						/>
					</div>
					<div className="flex justify-end">
						<Button
							onClick={() => {
								if (passwordRequired) {
									const submitPasswordError = getPasswordValidationError(password)
									setShowPasswordValidationError(Boolean(submitPasswordError))
									if (submitPasswordError) {
										toast.error(submitPasswordError)
										return
									}
								}
								createMutation.mutate()
							}}
							disabled={
								createMutation.isPending ||
								!name.trim() ||
								!content.trim()
							}
						>
							{createMutation.isPending ? 'Creating...' : 'Create Paste'}
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>My Pastes</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>ID</TableHead>
								<TableHead>Name</TableHead>
								<TableHead>Visibility</TableHead>
								<TableHead>Expires</TableHead>
								<TableHead>Protection</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.length === 0 ? (
								<TableRow>
									<TableCell colSpan={6} className="text-center text-muted-foreground">
										No pastes yet.
									</TableCell>
								</TableRow>
							) : (
								rows.map((paste) => (
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
										<TableCell className="capitalize">{paste.visibility}</TableCell>
										<TableCell>{paste.expiresAt ?? 'indefinite'}</TableCell>
										<TableCell>{paste.isPasswordProtected ? 'protected' : 'unprotected'}</TableCell>
										<TableCell className="text-right">
											<div className="inline-flex items-center gap-2">
												<Link to={`/pastes/${paste.id}/edit`}>
													<Button
														variant="ghost"
														size="icon"
														aria-label={`Edit paste ${paste.name}`}
														title="Edit paste"
													>
														<Pencil className="h-4 w-4" />
													</Button>
												</Link>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => requestDeletePaste(paste.id, paste.name)}
													disabled={deleteMutation.isPending}
													aria-label={`Delete paste ${paste.name}`}
													title="Delete paste"
												>
													<Trash2 className="h-4 w-4 text-destructive" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
			{confirmationDialog}
		</Container>
	)
}
