import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'

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
import { PasteFeedback } from '@/features/pastes/feedback'
import {
	EXPIRATION_PRESETS,
	getExpirationOptions,
	getPasswordChecks,
	getPasswordValidationError,
	PASSWORD_SYMBOLS,
} from '@/features/pastes/form'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { apiClient } from '@/lib/api'
import toast from '@/lib/toast'

import type { ExpirationValue } from '@/features/pastes/form'

function inferExpirationValue(
	expiresAt: string | null,
	presets: readonly ExpirationValue[]
): ExpirationValue {
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
	const { t } = useAppTranslation()
	usePageTitle(t('pastes.edit'))

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
			setExpiration(inferExpirationValue(data.paste.expiresAt, EXPIRATION_PRESETS))
			setIsUnlocked(true)
			setInitialized(true)
		},
		onError: (error) => {
			toast.error(
				error instanceof Error && error.message ? (
					error.message
				) : (
					<PasteFeedback messageKey="pastes.feedback.unlockFailed" />
				)
			)
		},
	})

	const expirationOptions = getExpirationOptions(t)

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
		setExpiration(inferExpirationValue(paste.expiresAt, EXPIRATION_PRESETS))
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
			toast.success(<PasteFeedback messageKey="pastes.feedback.saved" />)
			void queryClient.invalidateQueries({ queryKey: ['pastes', 'mine'] })
			void queryClient.invalidateQueries({ queryKey: ['paste', 'view', id, true] })
			void queryClient.invalidateQueries({ queryKey: ['paste', 'edit', id] })
			void navigate('/pastes')
		},
		onError: (error) =>
			toast.error(
				error instanceof Error && error.message ? (
					error.message
				) : (
					<PasteFeedback messageKey="pastes.feedback.saveFailed" />
				)
			),
	})

	if (!isAuthenticated) return <Navigate to="/" replace />
	if (viewQuery.isLoading) return <LoadingPage label={t('pastes.loading')} />

	return (
		<Container className="space-y-6">
			<PageHeader
				title={t('pastes.edit')}
				description={t('pastes.editDescription')}
				action={
					<Button variant="ghost" onClick={() => void navigate('/pastes')}>
						<ArrowLeft className="h-4 w-4" />
						{t('pastes.back')}
					</Button>
				}
			/>
			<PasswordPromptDialog
				open={unlockDialogOpen}
				title={t('pastes.passwordTitle')}
				description={t('pastes.unlockDescription')}
				confirmLabel={t('pastes.unlock')}
				pending={decryptMutation.isPending}
				onCancel={() => {
					if (decryptMutation.isPending) return
					setUnlockDialogOpen(false)
					void navigate('/pastes')
				}}
				onConfirm={(unlockPassword) => {
					if (!decryptMutation.isPending) decryptMutation.mutate(unlockPassword)
				}}
			/>
			<Card>
				<CardHeader>
					<CardTitle>{t('pastes.details')}</CardTitle>
				</CardHeader>
				<CardContent>
					<fieldset
						className="min-w-0"
						disabled={saveMutation.isPending || viewQuery.isError || !initialized}
					>
						{viewQuery.isError ? (
							<div className="text-sm text-muted-foreground">{t('pastes.editUnavailable')}</div>
						) : null}
						<div className="mb-4 grid gap-4 md:grid-cols-2">
							<div className="flex items-center gap-3">
								<Switch id="paste-visibility" checked={isPublic} onCheckedChange={setIsPublic} />
								<Label htmlFor="paste-visibility">{t('pastes.publicUrl')}</Label>
							</div>
							<div className="flex items-center gap-3">
								<Switch
									id="paste-protection"
									checked={isPasswordProtected}
									onCheckedChange={setIsPasswordProtected}
									disabled={isPublic}
								/>
								<Label htmlFor="paste-protection">{t('pastes.passwordProtect')}</Label>
							</div>
							<div>
								<Label htmlFor="paste-expiration">{t('pastes.expiration')}</Label>
								<Select
									inputId="paste-expiration"
									className="mt-1"
									value={String(expiration)}
									onValueChange={(value) =>
										setExpiration(value === 'indefinite' ? 'indefinite' : Number(value))
									}
									options={expirationOptions}
								/>
							</div>
							<div>
								<Label htmlFor="paste-name">{t('pastes.name')}</Label>
								<Input
									id="paste-name"
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder={t('pastes.namePlaceholder')}
								/>
							</div>
							<div>
								<Label htmlFor="paste-password">
									{passwordRequired ? t('common.password') : t('pastes.passwordOptional')}
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
														id="paste-password"
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
														key={check.key}
														className={check.valid ? 'text-green-500' : 'text-destructive'}
													>
														{check.valid ? '✓' : '✕'} {t(check.key, { symbols: PASSWORD_SYMBOLS })}
													</div>
												))}
											</div>
										</HoverPopover>
									) : (
										<Input
											value={password}
											onChange={(e) => setPassword(e.target.value)}
											id="paste-password"
											type="password"
											disabled={!isPasswordProtected}
										/>
									)}
								</div>
								{showPasswordValidationError && passwordError && (
									<p role="alert" className="mt-1 text-sm text-destructive">
										{t(passwordError, { symbols: PASSWORD_SYMBOLS })}
									</p>
								)}
								<p className="mt-1 text-xs text-muted-foreground">{t('pastes.passwordWarning')}</p>
							</div>
						</div>
						<div className="mb-4">
							<Label htmlFor="paste-content">{t('pastes.content')}</Label>
							<Textarea
								id="paste-content"
								value={content}
								onChange={(e) => setContent(e.target.value)}
								rows={10}
								placeholder={t('pastes.contentPlaceholder')}
							/>
						</div>
						<div className="flex justify-end">
							<Button
								onClick={() => {
									if (passwordRequired) {
										const submitPasswordError = getPasswordValidationError(password)
										setShowPasswordValidationError(Boolean(submitPasswordError))
										if (submitPasswordError) {
											toast.error(<PasteFeedback messageKey={submitPasswordError} />)
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
								{saveMutation.isPending ? t('pastes.saving') : t('pastes.save')}
							</Button>
						</div>
					</fieldset>
				</CardContent>
			</Card>
		</Container>
	)
}
