/**
 * Corporation Settings Page
 *
 * Allows corporation CEOs and site admins to configure recruiting settings.
 * Settings include: recruiting status, short description, and full description.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatNumber, i18n, useAppTranslation } from '@/i18n'
import { api } from '@/lib/api'

import { useCanAccessCorporation } from '../hooks'

import type { FormEvent } from 'react'

// ============================================================================
// Component
// ============================================================================

export default function CorporationSettings() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const navigate = useNavigate()
	const { showSuccess, showError } = useMessage()
	const { t } = useAppTranslation()
	const queryClient = useQueryClient()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()

	// Form state
	const [isRecruiting, setIsRecruiting] = useState(true)
	const [shortDescription, setShortDescription] = useState('')
	const [fullDescription, setFullDescription] = useState('')
	const [hasChanges, setHasChanges] = useState(false)
	const {
		isLoading: accessLoading,
		userRole,
		hrRole,
		corporation: accessCorp,
	} = useCanAccessCorporation(corporationId ?? '')
	const isMemberCorporation = accessCorp?.isMemberCorporation === true
	const canManageSettings =
		user?.is_admin === true ||
		(isMemberCorporation &&
			(userRole === 'CEO' || userRole === 'Director' || hrRole === 'hr_admin'))

	// Fetch corporation details
	const {
		data: corporation,
		isLoading: corpLoading,
		error: corpError,
	} = useQuery({
		queryKey: ['corporations', corporationId],
		queryFn: () => api.getCorporationDetail(corporationId!),
		enabled: !!corporationId && canManageSettings,
	})

	// Set page title
	usePageTitle(
		corporation
			? t('corporations.settings.pageTitleNamed', { name: corporation.name })
			: t('corporations.settings.pageTitle')
	)

	// Update form when corporation data loads
	useEffect(() => {
		if (corporation) {
			setIsRecruiting(corporation.isRecruiting)
			setShortDescription(corporation.shortDescription || '')
			setFullDescription(corporation.fullDescription || '')
			setHasChanges(false)
		}
	}, [corporation])

	// Track changes
	useEffect(() => {
		if (corporation) {
			const changed =
				isRecruiting !== corporation.isRecruiting ||
				shortDescription !== (corporation.shortDescription || '') ||
				fullDescription !== (corporation.fullDescription || '')
			setHasChanges(changed)
		}
	}, [isRecruiting, shortDescription, fullDescription, corporation])

	const shortDescError =
		shortDescription.length > 250
			? t('corporations.settings.shortDescriptionError', { count: 250 })
			: ''

	// Update settings mutation
	const updateSettings = useMutation({
		mutationFn: () =>
			api.updateCorporationSettings(corporationId!, {
				isRecruiting,
				shortDescription: shortDescription || undefined,
				fullDescription: fullDescription || undefined,
			}),
		onSuccess: (data) => {
			// Update cache
			queryClient.setQueryData(['corporations', corporationId], data)
			void queryClient.invalidateQueries({ queryKey: ['corporations', 'browse'] })

			showSuccess(i18n.t('corporations.settings.saved'))

			setHasChanges(false)
		},
		onError: (error) => {
			showError(
				error instanceof Error ? error.message : i18n.t('corporations.settings.updateFailed')
			)
		},
	})

	// Form submission
	const handleSubmit = (e: FormEvent) => {
		e.preventDefault()
		if (shortDescError) return
		updateSettings.mutate()
	}

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check corporation ID
	if (!corporationId) {
		return <Navigate to="/corporations" replace />
	}

	// Loading state
	if (authLoading || accessLoading || corpLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	if (!canManageSettings) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							{t('corporations.accessDenied')}
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{t('corporations.settings.accessDeniedDescription')}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="ghost" onClick={() => navigate('/corporations')}>
							<ArrowLeft className="h-4 w-4" />
							{t('corporations.backToCorporations')}
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	// Error state
	if (corpError || !corporation) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							{t('corporations.notFound')}
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{t('corporations.notFoundDescription')}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="ghost" onClick={() => navigate('/corporations')}>
							<ArrowLeft className="h-4 w-4" />
							{t('corporations.backToCorporations')}
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	// Character count for short description
	const shortDescLength = shortDescription.length
	const shortDescRemaining = 250 - shortDescLength

	return (
		<Container>
			{/* Breadcrumbs */}
			<Breadcrumb className="mb-6">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink to="/corporations">{t('corporations.title')}</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbLink to={`/corporations/${corporationId}/members`}>
							{corporation.name}
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>{t('corporations.settings.breadcrumb')}</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			{/* Header */}
			<PageHeader
				title={t('corporations.settings.title')}
				description={t('corporations.settings.description', { name: corporation.name })}
				action={
					<Button
						variant="ghost"
						onClick={() => navigate(`/corporations/${corporationId}/members`)}
					>
						<ArrowLeft className="h-4 w-4" />
						{t('corporations.settings.backToManage')}
					</Button>
				}
			/>

			{/* Settings Form */}
			<form onSubmit={handleSubmit} className="space-y-6">
				{/* Recruiting Status Section */}
				<Card>
					<CardHeader>
						<CardTitle>{t('corporations.settings.recruitingStatus')}</CardTitle>
						<CardDescription>{t('corporations.settings.recruitingDescription')}</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="flex flex-row items-center justify-between rounded-lg border p-4">
							<div className="space-y-0.5">
								<Label htmlFor="is-recruiting" className="text-base">
									{t('corporations.settings.openForRecruitment')}
								</Label>
								<div className="text-sm text-muted-foreground">
									{t('corporations.settings.openForRecruitmentHint')}
								</div>
							</div>
							<Switch id="is-recruiting" checked={isRecruiting} onCheckedChange={setIsRecruiting} />
						</div>
					</CardContent>
				</Card>

				{/* Short Description Section */}
				<Card>
					<CardHeader>
						<CardTitle>{t('corporations.settings.shortDescription')}</CardTitle>
						<CardDescription>
							{t('corporations.settings.shortDescriptionHint', { count: 250 })}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							<Textarea
								aria-label={t('corporations.settings.shortDescription')}
								placeholder={t('corporations.settings.shortDescriptionPlaceholder')}
								className="min-h-[100px] resize-none"
								value={shortDescription}
								onChange={(e) => setShortDescription(e.target.value)}
							/>
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">
									{t('corporations.settings.shortDescriptionBrowseHint')}
								</span>
								<span
									className={shortDescRemaining < 0 ? 'text-destructive' : 'text-muted-foreground'}
								>
									{t('corporations.settings.charactersRemaining', {
										count: shortDescRemaining,
										value: formatNumber(shortDescRemaining),
									})}
								</span>
							</div>
							{shortDescError && <p className="text-sm text-destructive">{shortDescError}</p>}
						</div>
					</CardContent>
				</Card>

				{/* Full Description Section */}
				<Card>
					<CardHeader>
						<CardTitle>{t('corporations.settings.fullDescription')}</CardTitle>
						<CardDescription>{t('corporations.settings.fullDescriptionHint')}</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							<Textarea
								aria-label={t('corporations.settings.fullDescription')}
								placeholder={t('corporations.settings.fullDescriptionPlaceholder')}
								className="min-h-[300px] font-mono text-sm"
								value={fullDescription}
								onChange={(e) => setFullDescription(e.target.value)}
							/>
							<p className="text-sm text-muted-foreground">
								{t('corporations.settings.fullDescriptionFormattingHint')}
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Actions */}
				<div className="flex items-center gap-4">
					<Button
						variant="primary"
						type="submit"
						disabled={updateSettings.isPending || !hasChanges || !!shortDescError}
						className="w-full sm:w-auto"
					>
						{updateSettings.isPending ? (
							<>
								<LoadingSpinner size="sm" className="mr-2" />
								{t('corporations.settings.saving')}
							</>
						) : (
							<>
								<Save className="h-4 w-4" />
								{t('corporations.settings.save')}
							</>
						)}
					</Button>
					<Button
						variant="ghost"
						type="button"
						onClick={() => navigate(`/corporations/${corporationId}/members`)}
					>
						{t('common.cancel')}
					</Button>
				</div>
			</form>
		</Container>
	)
}
