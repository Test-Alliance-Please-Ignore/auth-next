import { Mic, RefreshCw, Users } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { canAccessMumble } from '@/features/mumble/access'
import { OneTimeCredentialsCard } from '@/features/mumble/components/credentials-card'
import { MumbleFeedback } from '@/features/mumble/components/feedback'
import { TempopSection } from '@/features/mumble/components/tempop-section'
import { useMumbleFeatureEnabled } from '@/features/mumble/feature'
import {
	useMumbleAccount,
	useProvisionMumbleAccount,
	useResetMumblePassword,
} from '@/features/mumble/hooks'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'
import { formatDateTime } from '@/lib/date-utils'
import toast from '@/lib/toast'

import type { MumbleOneTimeCredentials } from '@/features/mumble/types'

const TEMPOP_CREATE_URN = 'urn:mumble:tempop:create'
const TEMPOP_DELETE_URN = 'urn:mumble:tempop:delete'

export default function MumblePage() {
	const { t } = useAppTranslation()
	usePageTitle(t('mumble.title'))

	const { user, isLoading: authLoading, isAuthenticated } = useAuth()
	const { isEnabled: isMumbleFeatureEnabled, isLoading: isLoadingMumbleFeature } =
		useMumbleFeatureEnabled()
	const hasMumbleAccess = canAccessMumble(user)
	const canViewMumblePage = hasMumbleAccess && isMumbleFeatureEnabled
	const { data, isLoading, error } = useMumbleAccount(canViewMumblePage)
	const provision = useProvisionMumbleAccount()
	const resetPassword = useResetMumblePassword()
	const { hasPermission, isAdmin } = useUserPermissions()
	const canCreateTempop = isAdmin || hasPermission(TEMPOP_CREATE_URN)
	const canDeleteTempop = isAdmin || hasPermission(TEMPOP_DELETE_URN)
	const showTempopSection = canCreateTempop || canDeleteTempop

	// One-time credentials live only in component state, never persisted
	const [credentials, setCredentials] = useState<MumbleOneTimeCredentials | null>(null)
	const [resetDialogOpen, setResetDialogOpen] = useState(false)

	const account = data?.account ?? null
	const connection = data?.connection

	if (authLoading || isLoadingMumbleFeature || (canViewMumblePage && isLoading)) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<p className="text-muted-foreground">{t('mumble.loading')}</p>
			</div>
		)
	}

	if (!isAuthenticated) {
		return <Navigate to="/" replace />
	}

	if (!isMumbleFeatureEnabled || !hasMumbleAccess) {
		return <Navigate to="/dashboard" replace />
	}

	const handleProvision = () => {
		if (provision.isPending) return
		provision.mutate(undefined, {
			onSuccess: (result) => {
				setCredentials({
					loginName: result.account.loginName,
					password: result.password,
					connection: result.connection,
				})
			},
		})
	}

	const handleResetPassword = () => {
		if (resetPassword.isPending) return
		resetPassword.mutate(undefined, {
			onSuccess: (result) => {
				if (account) {
					setCredentials({
						loginName: account.loginName,
						password: result.password,
						connection: result.connection,
					})
				}
				setResetDialogOpen(false)
			},
			onError: (error) => {
				toast.error(
					error instanceof Error && error.message ? (
						error.message
					) : (
						<MumbleFeedback messageKey="mumble.failed" />
					)
				)
			},
		})
	}

	const mutationError = provision.error ?? resetPassword.error

	return (
		<Container>
			<PageHeader title={t('mumble.title')} description={t('mumble.description')} />

			<Section>
				<div className="space-y-4">
					{error ? (
						<Card variant="default" className="border-destructive/50">
							<CardContent role="alert" className="pt-6 text-sm text-destructive">
								{t('mumble.loadFailed')}
							</CardContent>
						</Card>
					) : null}

					{mutationError ? (
						<Card variant="default" className="border-destructive/50">
							<CardContent role="alert" className="pt-6 text-sm text-destructive">
								{mutationError instanceof Error && mutationError.message
									? mutationError.message
									: t('mumble.failed')}
							</CardContent>
						</Card>
					) : null}

					{credentials ? <OneTimeCredentialsCard credentials={credentials} /> : null}

					{!account && !error ? (
						<Card variant="default">
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Mic className="h-5 w-5" />
									{t('mumble.emptyTitle')}
								</CardTitle>
								<CardDescription>{t('mumble.emptyDescription')}</CardDescription>
							</CardHeader>
							<CardContent>
								<Button onClick={handleProvision} disabled={provision.isPending}>
									{provision.isPending ? t('mumble.creating') : t('mumble.create')}
								</Button>
							</CardContent>
						</Card>
					) : null}

					{account ? (
						<>
							<Card variant="default">
								<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
									<div>
										<CardTitle className="flex items-center gap-2">
											<Mic className="h-5 w-5" />
											{account.loginName}
										</CardTitle>
										<CardDescription>
											{connection ? `${connection.host}:${connection.port}` : null}
										</CardDescription>
									</div>
									<Badge variant={account.enabled ? 'default' : 'destructive'}>
										{account.enabled ? t('mumble.active') : t('mumble.disabled')}
									</Badge>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="text-sm text-muted-foreground">
										{account.lastAuthenticatedAt
											? t('mumble.lastConnected', {
													time: formatDateTime(account.lastAuthenticatedAt),
												})
											: t('mumble.neverConnected')}
									</div>
									<Button
										variant="secondary"
										onClick={() => {
											resetPassword.reset()
											setResetDialogOpen(true)
										}}
										disabled={resetPassword.isPending}
									>
										<RefreshCw className="h-4 w-4 mr-2" />
										{resetPassword.isPending ? t('mumble.generating') : t('mumble.regenerate')}
									</Button>
								</CardContent>
							</Card>

							<Card variant="default">
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-sm font-medium">
										<Users className="h-4 w-4" />
										{t('mumble.syncedGroups')}
									</CardTitle>
									<CardDescription>{t('mumble.groupsDescription')}</CardDescription>
								</CardHeader>
								<CardContent>
									{account.groups.length > 0 ? (
										<div className="flex flex-wrap gap-2">
											{account.groups.map((group) => (
												<Badge key={group} variant="secondary">
													{group}
												</Badge>
											))}
										</div>
									) : (
										<p className="text-sm text-muted-foreground">{t('mumble.noGroups')}</p>
									)}
								</CardContent>
							</Card>
						</>
					) : null}
				</div>
			</Section>

			{showTempopSection ? (
				<Section className="mt-8">
					<TempopSection canCreate={canCreateTempop} canManageAll={isAdmin || canDeleteTempop} />
				</Section>
			) : null}

			<ConfirmationDialog
				open={resetDialogOpen}
				title={t('mumble.resetTitle')}
				description={t('mumble.resetDescription')}
				confirmLabel={t('mumble.resetConfirm')}
				pending={resetPassword.isPending}
				onCancel={() => {
					if (!resetPassword.isPending) setResetDialogOpen(false)
				}}
				onConfirm={handleResetPassword}
			/>
		</Container>
	)
}
