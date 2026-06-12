import { Check, Copy, KeyRound, Mic, RefreshCw, Users } from 'lucide-react'
import { useState } from 'react'

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
import { usePageTitle } from '@/hooks/usePageTitle'

import type { MumbleOneTimeCredentials } from '@/features/mumble/types'

function CopyButton({ value }: { value: string }) {
	const [copied, setCopied] = useState(false)

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch {
			// Clipboard access denied — user can select the text manually
		}
	}

	return (
		<Button variant="ghost" size="sm" onClick={copy} aria-label="Copy to clipboard">
			{copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
		</Button>
	)
}

function OneTimeCredentialsCard({ credentials }: { credentials: MumbleOneTimeCredentials }) {
	return (
		<Card variant="default" className="border-amber-500/50">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<KeyRound className="h-5 w-5" />
					Your Mumble credentials
				</CardTitle>
				<CardDescription>
					This password is shown only once and cannot be recovered. Store it now — you can
					regenerate a new one later if you lose it.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="grid gap-2">
					<div className="flex items-center justify-between rounded-md border px-3 py-2">
						<div>
							<div className="text-xs text-muted-foreground">Username</div>
							<div className="font-mono">{credentials.loginName}</div>
						</div>
						<CopyButton value={credentials.loginName} />
					</div>
					<div className="flex items-center justify-between rounded-md border px-3 py-2">
						<div>
							<div className="text-xs text-muted-foreground">Password</div>
							<div className="font-mono break-all">{credentials.password}</div>
						</div>
						<CopyButton value={credentials.password} />
					</div>
					<div className="flex items-center justify-between rounded-md border px-3 py-2">
						<div>
							<div className="text-xs text-muted-foreground">Server</div>
							<div className="font-mono">
								{credentials.connection.host}:{credentials.connection.port}
							</div>
						</div>
						<CopyButton value={`${credentials.connection.host}:${credentials.connection.port}`} />
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

export default function MumblePage() {
	usePageTitle('Mumble')

	const { data, isLoading, error } = useMumbleAccount()
	const provision = useProvisionMumbleAccount()
	const resetPassword = useResetMumblePassword()

	// One-time credentials live only in component state, never persisted
	const [credentials, setCredentials] = useState<MumbleOneTimeCredentials | null>(null)
	const [resetDialogOpen, setResetDialogOpen] = useState(false)

	const account = data?.account ?? null
	const connection = data?.connection

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

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<p className="text-muted-foreground">Loading Mumble account...</p>
			</div>
		)
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
