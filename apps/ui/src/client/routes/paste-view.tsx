import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'

import { LocalePicker } from '@/components/locale-picker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { PasteFeedback } from '@/features/pastes/feedback'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { apiClient, AuthenticationError, AuthorizationError } from '@/lib/api'
import toast from '@/lib/toast'

export default function PasteViewPage() {
	const { t } = useAppTranslation()
	const { id = '' } = useParams<{ id: string }>()
	const { isAuthenticated, isLoading: isAuthLoading } = useAuth()
	const [password, setPassword] = useState('')
	const [copied, setCopied] = useState(false)
	const viewQuery = useQuery({
		queryKey: ['paste', 'view', id, isAuthenticated],
		queryFn: async () => {
			if (isAuthenticated) {
				try {
					const alliance = await apiClient.getPasteForAlliance(id)
					return { payload: alliance, viewer: 'alliance' as const }
				} catch (error) {
					if (!(error instanceof AuthenticationError || error instanceof AuthorizationError)) {
						throw error
					}
				}
			}
			const pub = await apiClient.getPasteForPublic(id)
			return { payload: pub, viewer: 'public' as const }
		},
		enabled: !!id && !isAuthLoading,
		retry: false,
		meta: { suppressErrorToast: true },
	})

	const decryptMutation = useMutation({
		mutationFn: () =>
			viewQuery.data?.viewer === 'alliance'
				? apiClient.decryptPasteForAlliance(id, password)
				: apiClient.decryptPasteForPublic(id, password),
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

	const data = decryptMutation.data ?? viewQuery.data?.payload
	const isAllianceViewer = viewQuery.data?.viewer === 'alliance'
	const isLocked = Boolean(data?.requiresPassword && !decryptMutation.data?.content)
	const decryptedPublicTitle =
		!isAllianceViewer && decryptMutation.data?.content && decryptMutation.data?.paste?.name?.trim()
			? decryptMutation.data.paste.name
			: null
	const pageTitle = isLocked
		? t('pastes.singular')
		: isAllianceViewer
			? data?.paste?.name?.trim() || t('pastes.singular')
			: decryptedPublicTitle || t('pastes.singular')
	usePageTitle(pageTitle)

	if (isAuthLoading || viewQuery.isLoading) {
		return (
			<Container>
				<div className="ml-auto w-44">
					<LocalePicker />
				</div>
				<LoadingPage label={t('pastes.loading')} />
			</Container>
		)
	}

	return (
		<Container className="space-y-4 min-h-[calc(100vh-8rem)]">
			<PageHeader
				title={pageTitle}
				action={
					<div className="w-44">
						<LocalePicker />
					</div>
				}
			/>
			{viewQuery.isError ? (
				<div className="flex min-h-[calc(100vh-18rem)] items-center justify-center">
					<Card className="w-full max-w-sm">
						<CardHeader className="text-center">
							<CardTitle>
								{isAllianceViewer ? t('pastes.unavailable') : t('pastes.notFound')}
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<p className="text-center text-sm text-muted-foreground">
								{isAllianceViewer ? t('pastes.loadFailed') : t('pastes.notFoundDescription')}
							</p>
						</CardContent>
					</Card>
				</div>
			) : null}
			{data?.requiresPassword ? (
				<div className="flex min-h-[calc(100vh-18rem)] items-center justify-center">
					<Card className="w-full max-w-sm">
						<CardHeader>
							<CardTitle>{t('pastes.passwordTitle')}</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<Label htmlFor="paste-unlock-password">{t('common.password')}</Label>
							<div className="flex flex-wrap items-center gap-2">
								<Input
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									id="paste-unlock-password"
									type="password"
									autoComplete="current-password"
									disabled={decryptMutation.isPending}
								/>
								<Button
									onClick={() => decryptMutation.mutate()}
									disabled={decryptMutation.isPending || !password}
								>
									{decryptMutation.isPending ? t('pastes.accessing') : t('pastes.access')}
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			) : null}
			{!viewQuery.isError && data?.content ? (
				<Card className="mt-4">
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle>{t('pastes.content')}</CardTitle>
						<Button
							variant="ghost"
							size="sm"
							className="relative"
							onClick={async () => {
								try {
									await navigator.clipboard.writeText(data.content ?? '')
									setCopied(true)
									toast.success(<PasteFeedback messageKey="pastes.feedback.contentCopied" />)
									setTimeout(() => setCopied(false), 1200)
								} catch {
									toast.error(<PasteFeedback messageKey="pastes.feedback.contentCopyFailed" />)
								}
							}}
							aria-label={t('pastes.copyContent')}
							title={t('pastes.copyContent')}
						>
							{copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
							<span>{copied ? t('pastes.copied') : t('pastes.copy')}</span>
						</Button>
					</CardHeader>
					<CardContent>
						<pre className="overflow-x-auto text-sm whitespace-pre-wrap">{data.content}</pre>
					</CardContent>
				</Card>
			) : null}
		</Container>
	)
}
