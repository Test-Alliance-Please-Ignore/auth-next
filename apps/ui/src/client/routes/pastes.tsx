import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { parseDateOrNull } from '@repo/worker-utils'

import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { HoverPopover } from '@/components/ui/hover-popover'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { PasteFeedback } from '@/features/pastes/feedback'
import {
	getExpirationOptions,
	getPasswordChecks,
	getPasswordValidationError,
	PASSWORD_SYMBOLS,
} from '@/features/pastes/form'
import { useAuth } from '@/hooks/useAuth'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatNumber, useAppTranslation } from '@/i18n'
import { apiClient } from '@/lib/api'
import { formatDateTime } from '@/lib/date-utils'
import toast from '@/lib/toast'

import type { DataTableColumn } from '@/components/data-table'
import type { ExpirationValue } from '@/features/pastes/form'
import type { PasteRecord } from '@/lib/api'

export default function PastesPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('pastes.title'))

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
	const settingsQuery = useQuery({
		queryKey: ['pastes', 'settings'],
		queryFn: () => apiClient.getPasteSettings(),
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
			toast.success(<PasteFeedback messageKey="pastes.feedback.created" />)
		},
		onError: (error) =>
			toast.error(
				error instanceof Error && error.message ? (
					error.message
				) : (
					<PasteFeedback messageKey="pastes.feedback.createFailed" />
				)
			),
	})

	const deleteMutation = useMutation({
		mutationFn: (id: string) => apiClient.deletePaste(id),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pastes', 'mine'] }),
		onError: (error) =>
			toast.error(
				error instanceof Error && error.message ? (
					error.message
				) : (
					<PasteFeedback messageKey="pastes.feedback.deleteFailed" />
				)
			),
	})

	const rows = mineQuery.data?.items ?? []
	const fallbackActiveCount = useMemo(() => {
		const nowMs = Date.now()
		return rows.filter((row) => {
			if (!row.expiresAt) return true
			const expiresAt = parseDateOrNull(row.expiresAt)
			if (!expiresAt) return true
			return expiresAt.getTime() >= nowMs
		}).length
	}, [rows])
	const apiActiveCount = Number(mineQuery.data?.activeCount ?? 0)
	const activeCount = Math.max(
		Number.isFinite(apiActiveCount) ? apiActiveCount : 0,
		fallbackActiveCount
	)
	const maxActivePastesPerUser = Number(
		mineQuery.data?.maxActivePastesPerUser ?? settingsQuery.data?.maxActivePastesPerUser ?? 0
	)
	const isAtPasteLimit = maxActivePastesPerUser > 0 && activeCount >= maxActivePastesPerUser
	const expirationOptions = getExpirationOptions(t)

	if (!isAuthenticated) return <Navigate to="/" replace />

	const handleCopyPasteUrl = async (pasteId: string) => {
		const url = `${window.location.origin}/paste/${pasteId}`
		try {
			await navigator.clipboard.writeText(url)
			setCopiedPasteId(pasteId)
			toast.success(<PasteFeedback messageKey="pastes.feedback.urlCopied" />)
			setTimeout(() => {
				setCopiedPasteId((current) => (current === pasteId ? null : current))
			}, 1200)
		} catch {
			toast.error(<PasteFeedback messageKey="pastes.feedback.urlCopyFailed" />)
		}
	}

	const requestDeletePaste = (pasteId: string, pasteName: string) => {
		requestConfirmation({
			title: (translate) => translate('pastes.deleteTitle'),
			description: (translate) => translate('pastes.deleteDescription', { name: pasteName }),
			confirmLabel: (translate) => translate('common.delete'),
			intent: 'destructive',
			onConfirm: async () => {
				await deleteMutation.mutateAsync(pasteId)
			},
		})
	}

	const columns: Array<DataTableColumn<PasteRecord>> = [
		{
			id: 'id',
			header: t('pastes.id'),
			cell: (paste) => (
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						onClick={() => void handleCopyPasteUrl(paste.id)}
						aria-label={t('pastes.copyUrlAria', { id: paste.id })}
						title={t('pastes.copyUrl')}
					>
						{copiedPasteId === paste.id ? (
							<Check className="h-3.5 w-3.5 text-green-500" />
						) : (
							<Copy className="h-3.5 w-3.5" />
						)}
					</Button>
					<Link className="font-mono underline" to={`/paste/${paste.id}`}>
						{paste.id}
					</Link>
				</div>
			),
		},
		{
			id: 'name',
			header: t('pastes.name'),
			cell: (paste) => (
				<Link className="underline" to={`/paste/${paste.id}`}>
					{paste.name}
				</Link>
			),
		},
		{
			id: 'visibility',
			header: t('pastes.visibility'),
			cell: (paste) => t(paste.visibility === 'public' ? 'pastes.public' : 'pastes.alliance'),
		},
		{
			id: 'expires',
			header: t('pastes.expires'),
			cell: (paste) => (paste.expiresAt ? formatDateTime(paste.expiresAt) : t('pastes.indefinite')),
		},
		{
			id: 'protection',
			header: t('pastes.protection'),
			cell: (paste) => t(paste.isPasswordProtected ? 'pastes.protected' : 'pastes.unprotected'),
		},
		{
			id: 'actions',
			header: t('pastes.actions'),
			className: 'text-right',
			headerClassName: 'text-right',
			cell: (paste) => (
				<div className="inline-flex items-center gap-2">
					<Button
						asChild
						variant="ghost"
						size="icon"
						aria-label={t('pastes.editAria', { name: paste.name })}
						title={t('pastes.edit')}
					>
						<Link to={`/pastes/${paste.id}/edit`}>
							<Pencil className="h-4 w-4" />
						</Link>
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => requestDeletePaste(paste.id, paste.name)}
						disabled={deleteMutation.isPending}
						aria-label={t('pastes.deleteAria', { name: paste.name })}
						title={t('pastes.delete')}
					>
						<Trash2 className="h-4 w-4 text-destructive" />
					</Button>
				</div>
			),
		},
	]

	return (
		<Container className="space-y-6">
			<PageHeader
				className="!mb-section md:!mb-10"
				title={t('pastes.title')}
				description={t('pastes.description')}
			/>
			<Card>
				<CardHeader>
					<CardTitle>{t('pastes.create')}</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="mb-4 grid gap-4">
						<div className="md:col-span-2">
							<Label htmlFor="paste-name">{t('pastes.name')}</Label>
							<Input
								id="paste-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder={t('pastes.namePlaceholder')}
								className="mt-1"
								disabled={isAtPasteLimit || createMutation.isPending}
							/>
						</div>
						<div className="grid gap-4 md:grid-cols-[1fr_3.5fr_0.5fr_1fr_3.5fr] md:items-start">
							<div>
								<Label htmlFor="paste-visibility">{t('pastes.visibility')}</Label>
								<div className="mt-1 flex h-10 items-center gap-2 px-1">
									<span className="min-w-14 text-sm">
										{isPublic ? t('pastes.public') : t('pastes.alliance')}
									</span>
									<Switch
										id="paste-visibility"
										checked={isPublic}
										onCheckedChange={handleVisibilityChange}
										disabled={isAtPasteLimit || createMutation.isPending}
									/>
								</div>
							</div>
							<div>
								<Label htmlFor="paste-expiration">{t('pastes.expiration')}</Label>
								<Select
									inputId="paste-expiration"
									className="mt-1"
									value={String(expiration)}
									disabled={isAtPasteLimit || createMutation.isPending}
									onValueChange={(value) =>
										setExpiration(value === 'indefinite' ? 'indefinite' : Number(value))
									}
									options={expirationOptions}
								/>
							</div>
							<div aria-hidden="true" />
							<div className={isPublic ? 'opacity-60' : undefined} aria-disabled={isPublic}>
								<Label htmlFor="paste-protection">{t('pastes.passwordProtect')}</Label>
								<div className="mt-1 flex h-10 items-center px-1">
									<Switch
										id="paste-protection"
										checked={isPasswordProtected}
										onCheckedChange={setIsPasswordProtected}
										disabled={isPublic || isAtPasteLimit || createMutation.isPending}
									/>
								</div>
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
														disabled={
															!isPasswordProtected || isAtPasteLimit || createMutation.isPending
														}
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
											disabled={!isPasswordProtected || isAtPasteLimit || createMutation.isPending}
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
					</div>
					<div className="mb-4">
						<Label htmlFor="paste-content">{t('pastes.content')}</Label>
						<Textarea
							id="paste-content"
							value={content}
							onChange={(e) => setContent(e.target.value)}
							rows={10}
							placeholder={t('pastes.contentPlaceholder')}
							disabled={isAtPasteLimit || createMutation.isPending}
						/>
					</div>
					<div className="flex justify-end">
						{isAtPasteLimit ? (
							<HoverPopover
								trigger={
									<div>
										<Button disabled>
											{createMutation.isPending ? t('pastes.creating') : t('pastes.create')}
										</Button>
									</div>
								}
								align="center"
							>
								<div className="text-xs">{t('pastes.limit')}</div>
							</HoverPopover>
						) : (
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
									createMutation.mutate()
								}}
								disabled={createMutation.isPending || !name.trim() || !content.trim()}
							>
								{createMutation.isPending ? t('pastes.creating') : t('pastes.create')}
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="flex flex-row items-start justify-between">
					<CardTitle>{t('pastes.mine')}</CardTitle>
					<p className="text-sm text-muted-foreground">
						{t('pastes.activeCount', {
							active: formatNumber(activeCount),
							maximum: maxActivePastesPerUser ? formatNumber(maxActivePastesPerUser) : '—',
						})}
					</p>
				</CardHeader>
				<CardContent>
					<DataTable
						variant="plain"
						columns={columns}
						rows={rows}
						getRowKey={(paste) => paste.id}
						loading={mineQuery.isLoading}
						error={mineQuery.error}
						errorMessage={t('pastes.listFailed')}
						emptyMessage={t('pastes.empty')}
					/>
				</CardContent>
			</Card>
			{confirmationDialog}
		</Container>
	)
}
