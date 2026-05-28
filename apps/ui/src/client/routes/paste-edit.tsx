import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { HoverPopover } from '@/components/ui/hover-popover'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { PasswordPromptDialog } from '@/components/ui/password-prompt-dialog'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
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

function inferExpirationValue(expiresAt: string | null, presets: Array<number | 'indefinite'>): ExpirationValue {
	if (!expiresAt) return 'indefinite'
	const expiryMs = new Date(expiresAt).getTime()
	const now = Date.now()
	const diffMinutes = Math.max(1, Math.round((expiryMs - now) / 60_000))
	const numericPresets = presets.filter((preset): preset is number => typeof preset === 'number')
	if (numericPresets.length === 0) return diffMinutes
	let best = numericPresets[0]
	let bestDistance = Math.abs(best - diffMinutes)
	for (const preset of numericPresets) {
		const distance = Math.abs(preset - diffMinutes)
		if (distance < bestDistance) {
			best = preset
			bestDistance = distance
		}
	}
	return best
}

export default function PasteEditPage() {
	const { isAuthenticated } = useAuth()
	const { id = '' } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const [name, setName] = useState('')
	const [content, setContent] = useState('')
	const [isPublic, setIsPublic] = useState(false)
	const [isPasswordProtected, setIsPasswordProtected] = useState(false)
	const [password, setPassword] = useState('')
	const [expiration, setExpiration] = useState<ExpirationValue>(60)
	const [initialized, setInitialized] = useState(false)
	const [unlockDialogOpen, setUnlockDialogOpen] = useState(false)
	const [isUnlocked, setIsUnlocked] = useState(false)
	const [showPasswordValidationError, setShowPasswordValidationError] = useState(false)
	const passwordRequired = isPasswordProtected
	const passwordError = passwordRequired ? getPasswordValidationError(password) : null
	const passwordChecks = getPasswordChecks(password)

	const viewQuery = useQuery({
		queryKey: ['paste', 'edit', id],
		queryFn: () => apiClient.getPasteForAlliance(id),
		enabled: isAuthenticated && !!id,
		retry: false,
	})

	const decryptMutation = useMutation({
		mutationFn: (unlockPassword: string) => apiClient.decryptPasteForAlliance(id, unlockPassword),
		onSuccess: (data, unlockPassword) => {
			setUnlockDialogOpen(false)
			setName(data.paste.name)
			setContent(data.content ?? '')
			setIsPublic(data.paste.visibility === 'public')
			setIsPasswordProtected(true)
			setPassword(unlockPassword)
			setExpiration(
				inferExpirationValue(
					data.paste.expiresAt,
					EXPIRATION_OPTIONS.map((option) => option.value)
				)
			)
			setIsUnlocked(true)
			setInitialized(true)
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Invalid password or unavailable paste')
		},
	})

	const expirationOptions = useMemo(
		() =>
			EXPIRATION_OPTIONS.map((option) => ({
				value: option.value,
				label: option.label,
			})),
		[]
	)

	useEffect(() => {
		if (!viewQuery.data || initialized) return
		const { paste, content: initialContent, requiresPassword } = viewQuery.data
		if (requiresPassword && !isUnlocked) {
			setUnlockDialogOpen(true)
			return
		}
		setName(paste.name)
		setIsPublic(paste.visibility === 'public')
		setIsPasswordProtected(requiresPassword || paste.isPasswordProtected)
		setContent(initialContent ?? '')
		setExpiration(
			inferExpirationValue(
				paste.expiresAt,
				EXPIRATION_OPTIONS.map((option) => option.value)
			)
		)
		setInitialized(true)
	}, [initialized, isUnlocked, viewQuery.data])

	useEffect(() => {
		if (isPublic) {
			setIsPasswordProtected(true)
		}
	}, [isPublic])

	useEffect(() => {
		if (!passwordRequired) {
			setShowPasswordValidationError(false)
		}
	}, [passwordRequired])

	const saveMutation = useMutation({
		mutationFn: () =>
			apiClient.updatePaste(id, {
				name,
				content,
				visibility: isPublic ? 'public' : 'alliance',
				expiration,
				isPasswordProtected,
				password: isPasswordProtected ? password : undefined,
			}),
		onSuccess: () => {
			toast.success('Paste saved')
			void queryClient.invalidateQueries({ queryKey: ['pastes', 'mine'] })
			void queryClient.invalidateQueries({ queryKey: ['paste', 'view', id, true] })
			void queryClient.invalidateQueries({ queryKey: ['paste', 'edit', id] })
			void navigate('/pastes')
		},
		onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to save paste'),
	})

	if (!isAuthenticated) return <Navigate to="/" replace />
	if (viewQuery.isLoading) return <LoadingPage label="Loading paste..." />

	return (
		<Container className="space-y-6">
			<PageHeader
				title="Edit Paste"
				description="Update paste content and protection settings."
				action={
					<Button variant="ghost" onClick={() => void navigate('/pastes')}>
						<ArrowLeft className="h-4 w-4" />
						Back to Pastes
					</Button>
				}
			/>
			<PasswordPromptDialog
				open={unlockDialogOpen}
				title="Password Required"
				description="Enter the paste password to load this protected paste for editing."
				confirmLabel="Unlock"
				pending={decryptMutation.isPending}
				onCancel={() => {
					setUnlockDialogOpen(false)
					void navigate('/pastes')
				}}
				onConfirm={(unlockPassword) => {
					decryptMutation.mutate(unlockPassword)
				}}
			/>
			<Card>
				<CardHeader>
					<CardTitle>Paste Details</CardTitle>
				</CardHeader>
				<CardContent>
					{viewQuery.isError ? (
						<div className="text-sm text-muted-foreground">
							Paste unavailable or you are not allowed to edit it.
						</div>
					) : null}
					<div className="mb-4 grid gap-4 md:grid-cols-2">
						<div className="flex items-center gap-3">
							<Switch checked={isPublic} onCheckedChange={setIsPublic} />
							<Label>Public by URL</Label>
						</div>
						<div className="flex items-center gap-3">
							<Switch
								checked={isPasswordProtected}
								onCheckedChange={setIsPasswordProtected}
								disabled={isPublic}
							/>
							<Label>Password Protect</Label>
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
						<div>
							<Label>Name</Label>
							<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Paste name" />
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
								saveMutation.mutate()
							}}
							disabled={
								saveMutation.isPending ||
								viewQuery.isError ||
								!initialized ||
								!name.trim() ||
								!content.trim()
							}
						>
							{saveMutation.isPending ? 'Saving...' : 'Save'}
						</Button>
					</div>
				</CardContent>
			</Card>
		</Container>
	)
}
