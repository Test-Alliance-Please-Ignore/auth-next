import { Check, Copy, ExternalLink, KeyRound, Mic, RefreshCw, Users } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
	useMumbleAccount,
	useProvisionMumbleAccount,
	useResetMumblePassword,
} from '@/features/mumble/hooks'
import { canAccessMumble } from '@/features/mumble/access'
import { useMumbleFeatureEnabled } from '@/features/mumble/feature'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import toast from '@/lib/toast'

import type { MumbleOneTimeCredentials } from '@/features/mumble/types'

function OneTimeCredentialsCard({ credentials }: { credentials: MumbleOneTimeCredentials }) {
	const [copiedField, setCopiedField] = useState<string | null>(null)
	const mumbleUrl = buildMumbleUrl(credentials)

	const copyToClipboard = (text: string, field: string, label: string) => {
		void navigator.clipboard.writeText(text).then(() => {
			toast.success(`${label} copied`)
			setCopiedField(field)
			setTimeout(() => setCopiedField(null), 2000)
		})
	}

	return (
		<Card variant="default" className="border-amber-500/50">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<KeyRound className="h-5 w-5" />
					Your Mumble credentials
				</CardTitle>
				<CardDescription>
					The password below is shown only once and cannot be recovered. Save the server,
					username, and password somewhere safe before you leave this page.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
					Once you close or refresh this page, the password will no longer be visible. If you
					lose it, you will need to generate a new one.
				</div>
				<CopyRow
					label="Username"
					value={credentials.loginName}
					copied={copiedField === 'username'}
					onCopy={() => copyToClipboard(credentials.loginName, 'username', 'Username')}
				/>
				<CopyRow
					label="Password"
					value={credentials.password}
					copied={copiedField === 'password'}
					onCopy={() => copyToClipboard(credentials.password, 'password', 'Password')}
				/>
				<CopyRow
					label="Server"
					value={`${credentials.connection.host}:${credentials.connection.port}`}
					copied={copiedField === 'server'}
					onCopy={() =>
						copyToClipboard(
							`${credentials.connection.host}:${credentials.connection.port}`,
							'server',
							'Server'
					)
				}
				/>
				<div className="pt-3">
					<Button asChild variant="primary" className="justify-center gap-2">
						<a href={mumbleUrl}>
							<ExternalLink className="h-4 w-4" />
							Connect in Mumble
						</a>
					</Button>
				</div>
			</CardContent>
		</Card>
	)
}

function buildMumbleUrl(credentials: MumbleOneTimeCredentials): string {
	const username = encodeURIComponent(credentials.loginName)
	const password = encodeURIComponent(credentials.password)
	const host = encodeURIComponent(credentials.connection.host)
	return `mumble://${username}:${password}@${host}:${credentials.connection.port}/`
}

function CopyRow({
	label,
	value,
	copied,
	onCopy,
}: {
	label: string
	value: string
	copied: boolean
	onCopy: () => void
}) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
			<div
				role="button"
				tabIndex={0}
				onClick={onCopy}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault()
						onCopy()
					}
				}}
				className={`flex cursor-pointer items-center gap-2.5 rounded-md border-2 px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
					copied
						? 'border-teal-500 bg-teal-500/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]'
						: 'border-zinc-500/50 bg-zinc-500/20 shadow-sm hover:border-zinc-500/70 hover:bg-zinc-500/30'
				}`}
			>
				<Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
				<span className="font-mono text-base">{value}</span>
				{copied ? <Check className="h-4 w-4 shrink-0 text-teal-300" /> : null}
			</div>
		</div>
	)
}

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
