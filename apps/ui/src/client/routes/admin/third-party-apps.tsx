import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
	THIRD_PARTY_APP_SUPPORTED_SCOPES,
	getThirdPartyAppScopeMetadata,
	type ThirdPartyAppScope,
} from '@repo/admin'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { usePageTitle } from '@/hooks/usePageTitle'

type OAuthClient = {
	clientId: string
	clientSecret?: string
	clientName?: string
	redirectUris?: string[]
	scopes?: ThirdPartyAppScope[]
	tokenEndpointAuthMethod?: string
	grantTypes?: string[]
	responseTypes?: string[]
	createdAt?: string
	updatedAt?: string
}

type OAuthClientListResponse = {
	clients?: OAuthClient[]
	data?: OAuthClient[]
	items?: OAuthClient[]
}

type CreateClientInput = {
	clientName: string
	redirectUris: string[]
	scopes: ThirdPartyAppScope[]
	tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post' | 'none'
	grantTypes: string[]
	responseTypes: string[]
}

async function thirdPartyAppsAdminRequest<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`/api/admin/third-party-apps${path}`, {
		...init,
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			'X-Requested-With': 'XMLHttpRequest',
			...(init?.headers ?? {}),
		},
	})

	if (!response.ok) {
		let message = `Request failed (${response.status})`
		try {
			const body = (await response.json()) as { error?: string; message?: string }
			message = body.message ?? body.error ?? message
		} catch {
			// no-op
		}
		throw new Error(message)
	}

	if (response.status === 204) return undefined as T
	return (await response.json()) as T
}

export default function AdminThirdPartyAppsPage() {
	usePageTitle('Admin - Third-Party Apps')
	const queryClient = useQueryClient()
	const [message, setMessage] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [clientName, setClientName] = useState('')
	const [redirectUrisText, setRedirectUrisText] = useState('')
	const [selectedScopes, setSelectedScopes] = useState<Set<ThirdPartyAppScope>>(
		() => new Set(['profile'])
	)
	const [secretDialogOpen, setSecretDialogOpen] = useState(false)
	const [latestSecret, setLatestSecret] = useState<{ clientId: string; clientSecret: string } | null>(null)

	const clientsQuery = useQuery({
		queryKey: ['admin-third-party-oauth-clients'],
		queryFn: () => thirdPartyAppsAdminRequest<OAuthClientListResponse>('/clients'),
	})

	const clients = useMemo(
		() => clientsQuery.data?.clients ?? clientsQuery.data?.items ?? clientsQuery.data?.data ?? [],
		[clientsQuery.data]
	)
	const scopeOptions = useMemo(
		() => THIRD_PARTY_APP_SUPPORTED_SCOPES.map((scope) => getThirdPartyAppScopeMetadata(scope)),
		[]
	)

	const createClientMutation = useMutation({
		mutationFn: (payload: CreateClientInput) =>
			thirdPartyAppsAdminRequest<OAuthClient>('/clients', {
				method: 'POST',
				body: JSON.stringify(payload),
			}),
		onSuccess: async (data) => {
			setMessage('Client created')
			setError(null)
			setClientName('')
			setRedirectUrisText('')
			setSelectedScopes(new Set(['profile']))
			if (data.clientSecret) {
				setLatestSecret({ clientId: data.clientId, clientSecret: data.clientSecret })
				setSecretDialogOpen(true)
			}
			await queryClient.invalidateQueries({ queryKey: ['admin-third-party-oauth-clients'] })
		},
		onError: (createError) => {
			setError(createError instanceof Error ? createError.message : 'Failed to create client')
			setMessage(null)
		},
	})

	const deleteClientMutation = useMutation({
		mutationFn: (targetClientId: string) =>
			thirdPartyAppsAdminRequest<void>(`/clients/${encodeURIComponent(targetClientId)}`, {
				method: 'DELETE',
			}),
		onSuccess: async () => {
			setMessage('Client deleted')
			setError(null)
			await queryClient.invalidateQueries({ queryKey: ['admin-third-party-oauth-clients'] })
		},
		onError: (deleteError) => {
			setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete client')
			setMessage(null)
		},
	})

	const regenerateSecretMutation = useMutation({
		mutationFn: (targetClientId: string) =>
			thirdPartyAppsAdminRequest<{ clientId: string; clientSecret: string }>(
				`/clients/${encodeURIComponent(targetClientId)}/regenerate-secret`,
				{ method: 'POST' }
			),
		onSuccess: (data) => {
			setLatestSecret(data)
			setSecretDialogOpen(true)
			setMessage('Client secret regenerated')
			setError(null)
		},
		onError: (regenerateError) => {
			setError(
				regenerateError instanceof Error ? regenerateError.message : 'Failed to regenerate secret'
			)
			setMessage(null)
		},
	})

	const handleCreate = () => {
		const redirectUris = redirectUrisText
			.split('\n')
			.map((entry) => entry.trim())
			.filter(Boolean)
		if (!clientName.trim() || redirectUris.length === 0) {
			setError('Client name and at least one redirect URI are required')
			setMessage(null)
			return
		}
		const scopes = [...selectedScopes]
		if (scopes.length === 0) {
			setError('At least one scope is required')
			setMessage(null)
			return
		}

		createClientMutation.mutate({
			clientName: clientName.trim(),
			redirectUris,
			scopes,
			tokenEndpointAuthMethod: 'client_secret_basic',
			grantTypes: ['authorization_code', 'refresh_token'],
			responseTypes: ['code'],
		})
	}

	const toggleScope = (scope: ThirdPartyAppScope, checked: boolean) => {
		setSelectedScopes((previous) => {
			const next = new Set(previous)
			if (checked) {
				next.add(scope)
			} else {
				next.delete(scope)
			}
			return next
		})
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-bold gradient-text">Third-Party Apps</h1>
				<p className="text-muted-foreground mt-1">
					Register and manage OAuth client applications for external integrations.
				</p>
			</div>

			{message ? (
				<Card className="border-primary bg-primary/10">
					<CardContent className="py-3 text-primary">{message}</CardContent>
				</Card>
			) : null}
			{error ? (
				<Card className="border-destructive bg-destructive/10">
					<CardContent className="py-3 text-destructive">{error}</CardContent>
				</Card>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>Create OAuth Client</CardTitle>
					<CardDescription>
						Add a client app with one or more allowed redirect callback URLs.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="oauth-client-name">Client Name</Label>
						<Input
							id="oauth-client-name"
							value={clientName}
							onChange={(event) => setClientName(event.target.value)}
							placeholder="Alliance Auth Tooling"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="oauth-redirect-uris">Redirect URIs (one per line)</Label>
						<Textarea
							id="oauth-redirect-uris"
							value={redirectUrisText}
							onChange={(event) => setRedirectUrisText(event.target.value)}
							placeholder={'https://example.app/callback\nhttps://example.app/oauth/callback'}
						/>
					</div>
					<div className="space-y-3">
						<Label>Allowed Scopes</Label>
						<div className="grid gap-2 sm:grid-cols-2">
							{scopeOptions.map((scopeOption) => (
								<label
									key={scopeOption.scope}
									className="flex items-start gap-3 rounded-md border border-border/60 px-3 py-2 text-sm"
								>
									<Checkbox
										checked={selectedScopes.has(scopeOption.scope)}
										onCheckedChange={(checked) => toggleScope(scopeOption.scope, checked === true)}
										className="mt-1"
									/>
									<span className="min-w-0 space-y-1">
										<span className="block font-medium text-foreground">{scopeOption.name}</span>
										<span className="block text-xs leading-5 text-muted-foreground">
											{scopeOption.description}
										</span>
										<span className="block break-all font-mono text-[11px] text-muted-foreground">
											{scopeOption.scope}
										</span>
									</span>
								</label>
							))}
						</div>
					</div>
					<Button
						onClick={handleCreate}
						loading={createClientMutation.isPending}
						loadingText="Creating..."
					>
						<Plus className="h-4 w-4" />
						Create Client
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between gap-3">
						<div>
							<CardTitle>Registered Clients</CardTitle>
							<CardDescription>Current app registrations and callback settings.</CardDescription>
						</div>
						<Button variant="secondary" onClick={() => clientsQuery.refetch()}>
							<RotateCcw className="h-4 w-4" />
							Refresh
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{clientsQuery.isLoading ? (
						<div className="py-8 text-center text-muted-foreground">Loading clients...</div>
					) : clients.length === 0 ? (
						<div className="py-8 text-center text-muted-foreground">No registered clients yet.</div>
					) : (
						<div className="space-y-3">
							{clients.map((client) => (
								<div
									key={client.clientId}
									className="rounded-lg border border-border/60 bg-card/60 p-4"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="space-y-1">
											<p className="font-semibold">{client.clientName ?? client.clientId}</p>
											<p className="text-xs text-muted-foreground font-mono">{client.clientId}</p>
											{client.redirectUris?.length ? (
												<p className="text-xs text-muted-foreground break-all">
													{client.redirectUris.join(', ')}
												</p>
											) : null}
											{client.scopes?.length ? (
												<div className="flex flex-wrap gap-2 pt-1">
													{client.scopes.map((scope) => {
														const scopeInfo = getThirdPartyAppScopeMetadata(scope)
														return (
															<span
																key={scope}
																className="rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground"
																title={scope}
															>
																{scopeInfo.name}
															</span>
														)
													})}
												</div>
											) : null}
										</div>
										<div className="flex items-center gap-2">
											<Button
												variant="secondary"
												size="sm"
												onClick={() => regenerateSecretMutation.mutate(client.clientId)}
												loading={regenerateSecretMutation.isPending}
												loadingText="Regenerating..."
												showIcon={false}
											>
												<RotateCcw className="h-4 w-4" />
												Regenerate Secret
											</Button>
											<Button
												variant="destructive"
												size="sm"
												onClick={() => deleteClientMutation.mutate(client.clientId)}
												loading={deleteClientMutation.isPending}
												loadingText="Deleting..."
												showIcon={false}
											>
												<Trash2 className="h-4 w-4" />
												Delete
											</Button>
										</div>
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			<Dialog open={secretDialogOpen} onOpenChange={setSecretDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New Client Secret</DialogTitle>
						<DialogDescription>
							This secret is only shown once. Copy it now and store it securely.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label>Client ID</Label>
						<Input readOnly value={latestSecret?.clientId ?? ''} />
					</div>
					<div className="space-y-2">
						<Label>Client Secret</Label>
						<Textarea readOnly value={latestSecret?.clientSecret ?? ''} className="font-mono text-xs" />
					</div>
					<DialogFooter>
						<Button variant="secondary" onClick={() => setSecretDialogOpen(false)}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
