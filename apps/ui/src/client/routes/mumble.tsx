import { Mic, RefreshCw, Users } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { OneTimeCredentialsCard } from '@/features/mumble/components/credentials-card'
import { TempopSection } from '@/features/mumble/components/tempop-section'
import {
	useMumbleAccount,
	useProvisionMumbleAccount,
	useResetMumblePassword,
} from '@/features/mumble/hooks'
import { canAccessMumble } from '@/features/mumble/access'
import { useMumbleFeatureEnabled } from '@/features/mumble/feature'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import type { MumbleOneTimeCredentials } from '@/features/mumble/types'

const TEMPOP_CREATE_URN = 'urn:mumble:tempop:create'
const TEMPOP_DELETE_URN = 'urn:mumble:tempop:delete'

export default function MumblePage() {
	usePageTitle('Mumble')

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
				<p className="text-muted-foreground">Loading Mumble account...</p>
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
			onError: () => {
				setResetDialogOpen(false)
			},
		})
	}

	const mutationError = provision.error ?? resetPassword.error

	return (
		<Container>
			<PageHeader title="Mumble" description="Voice server account linked to your auth groups" />

			<Section>
				<div className="space-y-4">
					{error ? (
						<Card variant="default" className="border-destructive/50">
							<CardContent className="pt-6 text-sm text-destructive">
								Failed to load your Mumble account. Try again later.
							</CardContent>
						</Card>
					) : null}

					{mutationError ? (
						<Card variant="default" className="border-destructive/50">
							<CardContent className="pt-6 text-sm text-destructive">
								{mutationError instanceof Error
									? mutationError.message
									: 'Something went wrong. Try again later.'}
							</CardContent>
						</Card>
					) : null}

					{credentials ? <OneTimeCredentialsCard credentials={credentials} /> : null}

					{!account && !error ? (
						<Card variant="default">
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Mic className="h-5 w-5" />
									No Mumble account yet
								</CardTitle>
								<CardDescription>
									Create a voice account to connect to the alliance Mumble server. Your account name
									is based on your main character and your channel access follows your groups
									automatically.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Button onClick={handleProvision} disabled={provision.isPending}>
									{provision.isPending ? 'Creating…' : 'Create Mumble account'}
								</Button>
							</CardContent>
						</Card>
					) : null}

					{account ? (
						<>
							<Card variant="default">
								<CardHeader className="flex flex-row items-center justify-between space-y-0">
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
										{account.enabled ? 'Active' : 'Disabled'}
									</Badge>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="text-sm text-muted-foreground">
										{account.lastAuthenticatedAt
											? `Last connected ${new Date(account.lastAuthenticatedAt).toLocaleString()}`
											: 'Never connected'}
									</div>
									<Button
										variant="secondary"
										onClick={() => setResetDialogOpen(true)}
										disabled={resetPassword.isPending}
									>
										<RefreshCw className="h-4 w-4 mr-2" />
										{resetPassword.isPending ? 'Generating…' : 'Regenerate password'}
									</Button>
								</CardContent>
							</Card>

							<Card variant="default">
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-sm font-medium">
										<Users className="h-4 w-4" />
										Synced groups
									</CardTitle>
									<CardDescription>
										Group access on the voice server follows your auth groups automatically.
									</CardDescription>
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
										<p className="text-sm text-muted-foreground">No groups synced yet.</p>
									)}
								</CardContent>
							</Card>
						</>
					) : null}
				</div>
			</Section>

			{showTempopSection ? (
				<Section className="mt-8">
					<TempopSection
						canCreate={canCreateTempop}
						canManageAll={isAdmin || canDeleteTempop}
					/>
				</Section>
			) : null}

			<ConfirmationDialog
				open={resetDialogOpen}
				title="Regenerate Mumble password?"
				description="Your current password stops working immediately. The new password is shown only once."
				confirmLabel="Regenerate"
				pending={resetPassword.isPending}
				onCancel={() => setResetDialogOpen(false)}
				onConfirm={handleResetPassword}
			/>
		</Container>
	)
}
