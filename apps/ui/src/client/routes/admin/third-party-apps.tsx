import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { getThirdPartyAppScopeMetadata, THIRD_PARTY_APP_SUPPORTED_SCOPES } from '@repo/admin'

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
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
import { HoverPopover } from '@/components/ui/hover-popover'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { usePageTitle } from '@/hooks/usePageTitle'
import toast from '@/lib/toast'

import {
	getThirdPartyAppScopeAccessLevel,
	groupThirdPartyAppScopeOptions,
	THIRD_PARTY_APP_REQUIRED_SCOPES,
} from './third-party-apps.helpers'

import type { KeyboardEvent } from 'react'
import type {
	OAuthClientCreateInput,
	OAuthClientSummary,
	OAuthClientUpdateInput,
	ThirdPartyAppScope,
} from '@repo/admin'
import type { SelectOption } from '@/components/ui/select'
import type { ThirdPartyAppScopeRow } from './third-party-apps.helpers'

type OAuthClientListResponse = {
	clients?: OAuthClientSummary[]
	data?: OAuthClientSummary[]
	items?: OAuthClientSummary[]
}

type OAuthTokenEndpointAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none'
type OAuthGrantType = 'authorization_code' | 'refresh_token'

const OAUTH_TOKEN_ENDPOINT_AUTH_METHOD_OPTIONS: SelectOption[] = [
	{
		value: 'client_secret_basic',
		label: 'Client Secret Basic',
		description: 'Confidential client authentication using HTTP Basic credentials.',
	},
	{
		value: 'client_secret_post',
		label: 'Client Secret Post',
		description: 'Confidential client authentication using form-encoded credentials.',
	},
	{
		value: 'none',
		label: 'Public Client',
		description: 'No client secret at the token endpoint. Use PKCE for browser flows.',
	},
]

const TOKEN_ENDPOINT_AUTH_HELP =
	'Choose how the client authenticates at the token endpoint. Public clients do not use a secret and should rely on PKCE.'

const OAUTH_GRANT_TYPE_DETAILS: Record<OAuthGrantType, { label: string; description: string }> = {
	authorization_code: {
		label: 'Authorization Code',
		description: 'Allow the app to complete the browser consent flow.',
	},
	refresh_token: {
		label: 'Refresh Token',
		description: 'Allow the app to refresh tokens after initial consent.',
	},
}

interface ClientFormState {
	clientName: string
	redirectUrisText: string
	tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod
	grantTypes: Set<OAuthGrantType>
	selectedScopes: Set<ThirdPartyAppScope>
}

function createDefaultClientFormState(): ClientFormState {
	return {
		clientName: '',
		redirectUrisText: '',
		tokenEndpointAuthMethod: 'client_secret_basic',
		grantTypes: new Set(['authorization_code', 'refresh_token']),
		selectedScopes: new Set(
			THIRD_PARTY_APP_SUPPORTED_SCOPES.filter(
				(scope) => getThirdPartyAppScopeMetadata(scope).category === 'identity'
			)
		),
	}
}

function clientSummaryToFormState(client: OAuthClientSummary): ClientFormState {
	return {
		clientName: client.clientName ?? '',
		redirectUrisText: client.redirectUris?.join('\n') ?? '',
		tokenEndpointAuthMethod:
			client.tokenEndpointAuthMethod === 'client_secret_post' ||
			client.tokenEndpointAuthMethod === 'none'
				? client.tokenEndpointAuthMethod
				: 'client_secret_basic',
		grantTypes: new Set(
			(client.grantTypes ?? ['authorization_code', 'refresh_token']).filter(
				(grant): grant is OAuthGrantType =>
					grant === 'authorization_code' || grant === 'refresh_token'
			)
		),
		selectedScopes: new Set([...(client.scopes ?? []), ...THIRD_PARTY_APP_REQUIRED_SCOPES]),
	}
}

function parseMultilineValues(value: string): string[] {
	return value
		.split('\n')
		.map((entry) => entry.trim())
		.filter(Boolean)
}

function getGrantTypes(grantTypes: Set<OAuthGrantType>): OAuthGrantType[] {
	const values: OAuthGrantType[] = []
	if (grantTypes.has('authorization_code')) values.push('authorization_code')
	if (grantTypes.has('refresh_token')) values.push('refresh_token')
	return values
}

function updateGrantTypeSet(
	previous: Set<OAuthGrantType>,
	grantTypes: readonly OAuthGrantType[],
	checked: boolean
): Set<OAuthGrantType> {
	const next = new Set(previous)
	for (const grantType of grantTypes) {
		if (checked) {
			next.add(grantType)
		} else {
			next.delete(grantType)
		}
	}
	return next
}

interface ClientAccessSettingsProps {
	form: ClientFormState
	idPrefix: string
	onChange: (updater: (previous: ClientFormState) => ClientFormState) => void
}

function ClientAccessSettings({ form, idPrefix, onChange }: ClientAccessSettingsProps) {
	const isPublicClient = form.tokenEndpointAuthMethod === 'none'
	const grantTypeEntries = (['authorization_code', 'refresh_token'] as const).map((grantType) => ({
		grantType,
		...OAUTH_GRANT_TYPE_DETAILS[grantType],
	}))

	return (
		<div className="grid gap-4 rounded-lg border border-border/60 bg-card/40 p-4 md:grid-cols-2">
			<div className="space-y-2">
				<Label
					htmlFor={`${idPrefix}-token-endpoint-auth-method`}
					className="inline-flex items-center gap-1.5"
				>
					<HoverPopover
						trigger={<span className="cursor-help">Token Endpoint Authentication</span>}
						side="top"
						align="start"
						className="w-80 border border-border bg-popover p-3 text-popover-foreground shadow-lg"
					>
						<div className="space-y-1">
							<div className="text-sm font-medium">Token Endpoint Authentication</div>
							<div className="text-sm text-muted-foreground">{TOKEN_ENDPOINT_AUTH_HELP}</div>
						</div>
					</HoverPopover>
				</Label>
				<Select
					inputId={`${idPrefix}-token-endpoint-auth-method`}
					options={OAUTH_TOKEN_ENDPOINT_AUTH_METHOD_OPTIONS}
					value={form.tokenEndpointAuthMethod}
					onValueChange={(value) =>
						onChange((previous) => ({
							...previous,
							tokenEndpointAuthMethod: value as OAuthTokenEndpointAuthMethod,
						}))
					}
					placeholder="Select authentication method"
					className="w-full"
				/>
				<p className="text-xs leading-5 text-muted-foreground">
					{isPublicClient
						? 'Public clients do not use a secret at the token endpoint.'
						: 'Confidential clients authenticate with a client secret at the token endpoint.'}
				</p>
			</div>
			<div className="space-y-2">
				<Label className="inline-flex items-center gap-1.5">
					<HoverPopover
						trigger={<span className="cursor-help">Grant Types</span>}
						side="top"
						align="start"
						className="w-80 border border-border bg-popover p-3 text-popover-foreground shadow-lg"
					>
						<div className="space-y-1">
							<div className="text-sm font-medium">Grant Types</div>
							<div className="text-sm text-muted-foreground">
								Choose how the client can obtain and renew tokens.
							</div>
						</div>
					</HoverPopover>
				</Label>
				<div className="space-y-2 rounded-md border border-border/60 bg-background/50 p-3">
					{grantTypeEntries.map(({ grantType, label, description }) => {
						const checked = form.grantTypes.has(grantType)
						return (
							<label
								key={grantType}
								className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40"
							>
								<Checkbox
									checked={checked}
									onCheckedChange={(nextChecked) =>
										onChange((previous) => ({
											...previous,
											grantTypes: updateGrantTypeSet(
												previous.grantTypes,
												[grantType],
												nextChecked === true
											),
										}))
									}
								/>
								<div className="space-y-0.5">
									<HoverPopover
										trigger={
											<div className="text-sm font-medium text-foreground cursor-help">{label}</div>
										}
										side="top"
										align="start"
										className="w-80 border border-border bg-popover p-3 text-popover-foreground shadow-lg"
									>
										<div className="space-y-1">
											<div className="text-sm font-medium">{label}</div>
											<div className="text-sm text-muted-foreground">{description}</div>
										</div>
									</HoverPopover>
									<div className="text-xs text-muted-foreground">{description}</div>
								</div>
							</label>
						)
					})}
				</div>
			</div>
		</div>
	)
}

function updateSelectedScopeSet(
	previous: Set<ThirdPartyAppScope>,
	scopes: readonly ThirdPartyAppScope[],
	checked: boolean
): Set<ThirdPartyAppScope> {
	const next = new Set(previous)
	for (const scope of scopes) {
		if (
			THIRD_PARTY_APP_REQUIRED_SCOPES.includes(
				scope as (typeof THIRD_PARTY_APP_REQUIRED_SCOPES)[number]
			)
		) {
			next.add(scope)
			continue
		}
		if (checked) {
			next.add(scope)
		} else {
			next.delete(scope)
		}
	}
	return next
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
	const [createForm, setCreateForm] = useState<ClientFormState>(() =>
		createDefaultClientFormState()
	)
	const [editForm, setEditForm] = useState<ClientFormState | null>(null)
	const [editingClient, setEditingClient] = useState<OAuthClientSummary | null>(null)
	const [editDialogOpen, setEditDialogOpen] = useState(false)
	const [secretDialogOpen, setSecretDialogOpen] = useState(false)
	const [latestSecret, setLatestSecret] = useState<{
		clientId: string
		clientSecret: string
	} | null>(null)
	const [secretCopiedField, setSecretCopiedField] = useState<'clientId' | 'clientSecret' | null>(
		null
	)

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
	const scopeSections = useMemo(() => groupThirdPartyAppScopeOptions(scopeOptions), [scopeOptions])
	const authPlatformSection = scopeSections.find((section) => section.key === 'auth-platform')
	const esiProxySection = scopeSections.find((section) => section.key === 'esi-proxy')
	const authPlatformScopeNames = authPlatformSection?.scopes.map((scope) => scope.scope) ?? []
	const authPlatformOptionalScopeNames = authPlatformScopeNames.filter(
		(scope) =>
			!THIRD_PARTY_APP_REQUIRED_SCOPES.includes(
				scope as (typeof THIRD_PARTY_APP_REQUIRED_SCOPES)[number]
			)
	)
	const selectedScopeCount = createForm.selectedScopes.size

	const copySecretField = async (
		value: string,
		field: 'clientId' | 'clientSecret',
		label: string
	) => {
		await navigator.clipboard.writeText(value)
		toast.success(`${label} copied`)
		setSecretCopiedField(field)
		setTimeout(() => setSecretCopiedField(null), 2000)
	}

	const createClientMutation = useMutation({
		mutationFn: (payload: OAuthClientCreateInput) =>
			thirdPartyAppsAdminRequest<OAuthClientSummary>('/clients', {
				method: 'POST',
				body: JSON.stringify(payload),
			}),
		onSuccess: async (data) => {
			setMessage('Client created')
			setError(null)
			setCreateForm(createDefaultClientFormState())
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

	const updateClientMutation = useMutation({
		mutationFn: ({ clientId, payload }: { clientId: string; payload: OAuthClientUpdateInput }) =>
			thirdPartyAppsAdminRequest<OAuthClientSummary>(`/clients/${encodeURIComponent(clientId)}`, {
				method: 'PATCH',
				body: JSON.stringify(payload),
			}),
		onSuccess: async (data) => {
			setMessage('Client updated')
			setError(null)
			setEditDialogOpen(false)
			setEditingClient(null)
			setEditForm(null)
			if (data.clientSecret) {
				setLatestSecret({ clientId: data.clientId, clientSecret: data.clientSecret })
				setSecretDialogOpen(true)
			}
			await queryClient.invalidateQueries({ queryKey: ['admin-third-party-oauth-clients'] })
		},
		onError: (updateError) => {
			setError(updateError instanceof Error ? updateError.message : 'Failed to update client')
			setMessage(null)
		},
	})

	const openEditClientDialog = (client: OAuthClientSummary) => {
		setEditingClient(client)
		setEditForm(clientSummaryToFormState(client))
		setEditDialogOpen(true)
	}

	const setEditScopes = (scopes: readonly ThirdPartyAppScope[], checked: boolean) => {
		setEditForm((previous) =>
			previous
				? {
						...previous,
						selectedScopes: updateSelectedScopeSet(previous.selectedScopes, scopes, checked),
					}
				: previous
		)
	}

	const toggleEditScope = (scope: ThirdPartyAppScope, checked: boolean) => {
		if (
			THIRD_PARTY_APP_REQUIRED_SCOPES.includes(
				scope as (typeof THIRD_PARTY_APP_REQUIRED_SCOPES)[number]
			)
		) {
			return
		}
		setEditScopes([scope], checked)
	}

	const handleUpdate = () => {
		if (!editingClient || !editForm) {
			setError('No client selected for editing')
			setMessage(null)
			return
		}

		const redirectUris = parseMultilineValues(editForm.redirectUrisText)
		if (!editForm.clientName.trim() || redirectUris.length === 0) {
			setError('Client name and at least one redirect URI are required')
			setMessage(null)
			return
		}
		const scopes = [...editForm.selectedScopes]
		if (scopes.length === 0) {
			setError('At least one scope is required')
			setMessage(null)
			return
		}

		updateClientMutation.mutate({
			clientId: editingClient.clientId,
			payload: {
				clientName: editForm.clientName.trim(),
				redirectUris,
				scopes,
				tokenEndpointAuthMethod: editForm.tokenEndpointAuthMethod,
				grantTypes: getGrantTypes(editForm.grantTypes),
				responseTypes: editingClient.responseTypes ?? ['code'],
			},
		})
	}

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
		const redirectUris = parseMultilineValues(createForm.redirectUrisText)
		if (!createForm.clientName.trim() || redirectUris.length === 0) {
			setError('Client name and at least one redirect URI are required')
			setMessage(null)
			return
		}
		const scopes = [...createForm.selectedScopes]
		if (scopes.length === 0) {
			setError('At least one scope is required')
			setMessage(null)
			return
		}

		createClientMutation.mutate({
			clientName: createForm.clientName.trim(),
			redirectUris,
			scopes,
			tokenEndpointAuthMethod: createForm.tokenEndpointAuthMethod,
			grantTypes: getGrantTypes(createForm.grantTypes),
			responseTypes: ['code'],
		})
	}

	const toggleScope = (scope: ThirdPartyAppScope, checked: boolean) => {
		if (
			THIRD_PARTY_APP_REQUIRED_SCOPES.includes(
				scope as (typeof THIRD_PARTY_APP_REQUIRED_SCOPES)[number]
			)
		) {
			return
		}
		setCreateForm((previous) => {
			return {
				...previous,
				selectedScopes: updateSelectedScopeSet(previous.selectedScopes, [scope], checked),
			}
		})
	}

	const setScopes = (scopes: readonly ThirdPartyAppScope[], checked: boolean) => {
		setCreateForm((previous) => {
			return {
				...previous,
				selectedScopes: updateSelectedScopeSet(previous.selectedScopes, scopes, checked),
			}
		})
	}

	const getScopeSelectionState = (
		scopes: readonly ThirdPartyAppScope[],
		selectedScopes = createForm.selectedScopes
	) => {
		const selectedCount = scopes.filter((scope) => selectedScopes.has(scope)).length
		return {
			totalCount: scopes.length,
			selectedCount,
			allSelected: scopes.length > 0 && selectedCount === scopes.length,
			someSelected: selectedCount > 0 && selectedCount < scopes.length,
		}
	}
	const authPlatformSelectionState = getScopeSelectionState(authPlatformScopeNames)
	const esiReadScopeNames =
		esiProxySection?.scopes
			.filter((scope) => scope.accessLevel === 'read')
			.map((scope) => scope.scope) ?? []
	const esiWriteScopeNames =
		esiProxySection?.scopes
			.filter((scope) => scope.accessLevel === 'write')
			.map((scope) => scope.scope) ?? []
	const esiReadSelectionState = getScopeSelectionState(esiReadScopeNames)
	const esiWriteSelectionState = getScopeSelectionState(esiWriteScopeNames)
	const editAuthPlatformSelectionState = editForm
		? getScopeSelectionState(authPlatformScopeNames, editForm.selectedScopes)
		: authPlatformSelectionState
	const editEsiReadSelectionState = editForm
		? getScopeSelectionState(esiReadScopeNames, editForm.selectedScopes)
		: esiReadSelectionState
	const editEsiWriteSelectionState = editForm
		? getScopeSelectionState(esiWriteScopeNames, editForm.selectedScopes)
		: esiWriteSelectionState

	const renderScopeRows = (
		scopes: ThirdPartyAppScopeRow[],
		selectedScopesSet: Set<ThirdPartyAppScope> = createForm.selectedScopes,
		onToggleScope: (scope: ThirdPartyAppScope, checked: boolean) => void = toggleScope
	) => (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="w-10" />
					<TableHead className="w-[18rem]">Scope</TableHead>
					<TableHead className="w-24">Access</TableHead>
					<TableHead>Details</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{scopes.map((scopeRow) => {
					const accessLevel = getThirdPartyAppScopeAccessLevel(scopeRow.scope)
					const isSelected = selectedScopesSet.has(scopeRow.scope)
					const isRequired = THIRD_PARTY_APP_REQUIRED_SCOPES.includes(
						scopeRow.scope as (typeof THIRD_PARTY_APP_REQUIRED_SCOPES)[number]
					)
					const rowInteractionProps = isRequired
						? ({
								'aria-disabled': true,
								onClick: undefined,
								onKeyDown: undefined,
							} as const)
						: ({
								role: 'button' as const,
								tabIndex: 0,
								onClick: () => toggleScope(scopeRow.scope, !isSelected),
								onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault()
										toggleScope(scopeRow.scope, !isSelected)
									}
								},
							} as const)
					return (
						<TableRow
							key={scopeRow.scope}
							data-selected={isSelected}
							{...rowInteractionProps}
							className={`align-top transition-colors ${
								isRequired ? 'cursor-not-allowed bg-muted/30' : 'cursor-pointer hover:bg-muted/40'
							} data-[selected=true]:!bg-success/10 data-[selected=true]:outline data-[selected=true]:outline-1 data-[selected=true]:outline-success/40 data-[selected=true]:shadow-[inset_0_0_0_1px_hsl(var(--success)/0.35)]`}
						>
							<TableCell className="pt-3">
								<Checkbox
									onClick={(event) => event.stopPropagation()}
									checked={selectedScopesSet.has(scopeRow.scope)}
									disabled={isRequired}
									onCheckedChange={(checked) => onToggleScope(scopeRow.scope, checked === true)}
								/>
							</TableCell>
							<TableCell className="pt-3 font-mono text-xs font-semibold text-foreground">
								<span className="flex items-center gap-2">
									<span>{scopeRow.scope}</span>
									{isRequired ? <Badge variant="ghost">Required</Badge> : null}
								</span>
							</TableCell>
							<TableCell className="pt-2">
								<Badge variant={accessLevel === 'read' ? 'success' : 'warning'}>
									{accessLevel === 'read' ? 'Read' : 'Write'}
								</Badge>
							</TableCell>
							<TableCell className="pt-3">
								<div className="space-y-1">
									<div className="font-medium text-foreground">{scopeRow.name}</div>
									<div className="text-xs leading-5 text-muted-foreground">
										{scopeRow.description}
									</div>
								</div>
							</TableCell>
						</TableRow>
					)
				})}
			</TableBody>
		</Table>
	)

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
				<CardHeader className="space-y-0">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="space-y-1">
							<CardTitle>Create OAuth Client</CardTitle>
							<CardDescription>
								Add a client app with one or more allowed redirect callback URLs.
							</CardDescription>
						</div>
						<Button
							onClick={handleCreate}
							loading={createClientMutation.isPending}
							loadingText="Creating..."
							className="shrink-0"
						>
							<Plus className="h-4 w-4" />
							Create Client
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="oauth-client-name">Client Name</Label>
						<Input
							id="oauth-client-name"
							value={createForm.clientName}
							onChange={(event) =>
								setCreateForm((previous) => ({ ...previous, clientName: event.target.value }))
							}
							placeholder="Alliance Auth Tooling"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="oauth-redirect-uris">Redirect URIs (one per line)</Label>
						<Textarea
							id="oauth-redirect-uris"
							value={createForm.redirectUrisText}
							onChange={(event) =>
								setCreateForm((previous) => ({ ...previous, redirectUrisText: event.target.value }))
							}
							placeholder={'https://example.app/callback\nhttps://example.app/oauth/callback'}
						/>
					</div>
					<ClientAccessSettings
						form={createForm}
						idPrefix="create"
						onChange={(updater) => setCreateForm((previous) => updater(previous))}
					/>
					<details className="rounded-lg border border-border/60 bg-card/40 px-3 py-3">
						<summary className="cursor-pointer text-sm font-medium text-foreground">
							Allowed Scopes
							<span className="ml-2 text-xs text-muted-foreground">
								{selectedScopeCount} selected of{' '}
								{scopeSections.reduce((total, section) => total + section.scopes.length, 0)} total
							</span>
						</summary>
						<div className="mt-4 space-y-4">
							{authPlatformSection ? (
								<Card className="border-border/60 bg-card/40">
									<CardHeader className="space-y-3 pb-3">
										<div className="flex flex-wrap items-center justify-between gap-3">
											<div>
												<CardTitle className="text-base">{authPlatformSection.label}</CardTitle>
												<CardDescription>{authPlatformSection.description}</CardDescription>
											</div>
											<div
												className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40"
												role="button"
												tabIndex={0}
												onClick={() =>
													setScopes(
														authPlatformOptionalScopeNames,
														!authPlatformSelectionState.allSelected
													)
												}
												onKeyDown={(event) => {
													if (event.key === 'Enter' || event.key === ' ') {
														event.preventDefault()
														setScopes(
															authPlatformOptionalScopeNames,
															!authPlatformSelectionState.allSelected
														)
													}
												}}
											>
												<Checkbox
													checked={
														authPlatformSelectionState.allSelected
															? true
															: authPlatformSelectionState.someSelected
																? 'indeterminate'
																: false
													}
													onClick={(event) => event.stopPropagation()}
													onCheckedChange={(checked) =>
														setScopes(authPlatformOptionalScopeNames, checked === true)
													}
												/>
												<span className="text-sm font-medium text-foreground">Select all</span>
												<Badge variant="ghost" className="text-xs">
													{authPlatformSelectionState.selectedCount}/{authPlatformScopeNames.length}
												</Badge>
											</div>
										</div>
									</CardHeader>
									<CardContent>{renderScopeRows(authPlatformSection.scopes)}</CardContent>
								</Card>
							) : null}

							{esiProxySection ? (
								<Card className="border-border/60 bg-card/40">
									<CardHeader className="space-y-3 pb-3">
										<div className="flex flex-wrap items-center justify-between gap-3">
											<div>
												<CardTitle className="text-base">{esiProxySection.label}</CardTitle>
												<CardDescription>{esiProxySection.description}</CardDescription>
											</div>
											<div className="flex flex-wrap items-center gap-2">
												{(['read', 'write'] as const).map((accessLevel) => {
													const selectionState =
														accessLevel === 'read' ? esiReadSelectionState : esiWriteSelectionState
													const accessScopes =
														accessLevel === 'read' ? esiReadScopeNames : esiWriteScopeNames
													return (
														<div
															key={accessLevel}
															className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40"
															role="button"
															tabIndex={0}
															onClick={() => setScopes(accessScopes, !selectionState.allSelected)}
															onKeyDown={(event) => {
																if (event.key === 'Enter' || event.key === ' ') {
																	event.preventDefault()
																	setScopes(accessScopes, !selectionState.allSelected)
																}
															}}
														>
															<Checkbox
																checked={
																	selectionState.allSelected
																		? true
																		: selectionState.someSelected
																			? 'indeterminate'
																			: false
																}
																onClick={(event) => event.stopPropagation()}
																onCheckedChange={(checked) =>
																	setScopes(accessScopes, checked === true)
																}
															/>
															<span className="text-sm font-medium text-foreground">
																Select all {accessLevel}
															</span>
															<Badge
																variant={accessLevel === 'read' ? 'success' : 'warning'}
																className="text-xs"
															>
																{selectionState.selectedCount}/{selectionState.totalCount}
															</Badge>
														</div>
													)
												})}
											</div>
										</div>
									</CardHeader>
									<CardContent>
										<Accordion type="multiple" className="space-y-2">
											{esiProxySection.domainGroups.map((domainGroup) => (
												<AccordionItem
													key={domainGroup.key}
													value={domainGroup.key}
													className="rounded-lg border border-border/60 border-b-0 bg-background/40 px-3"
												>
													<AccordionTrigger className="py-3 text-sm font-medium text-foreground hover:no-underline">
														<span className="flex min-w-0 flex-1 items-center gap-2">
															<span className="truncate">{domainGroup.label}</span>
															<Badge
																variant="ghost"
																className="text-[10px] uppercase tracking-wide"
															>
																{domainGroup.scopes.length} scopes
															</Badge>
														</span>
													</AccordionTrigger>
													<AccordionContent className="pb-0">
														<div className="pb-3">{renderScopeRows(domainGroup.scopes)}</div>
													</AccordionContent>
												</AccordionItem>
											))}
										</Accordion>
									</CardContent>
								</Card>
							) : null}
						</div>
					</details>
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
									<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
										<div className="space-y-3">
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
										<div className="flex flex-wrap items-center gap-2 lg:justify-end">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => openEditClientDialog(client)}
												showIcon={false}
											>
												Edit
											</Button>
											<Button
												variant="primary"
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

			<Dialog
				open={editDialogOpen}
				onOpenChange={(open) => {
					setEditDialogOpen(open)
					if (!open) {
						setEditingClient(null)
						setEditForm(null)
					}
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>Edit OAuth Client</DialogTitle>
						<DialogDescription>
							Update registered client details, redirect URIs, and allowed scopes.
						</DialogDescription>
					</DialogHeader>
					{editForm ? (
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="edit-client-name">Client Name</Label>
								<Input
									id="edit-client-name"
									value={editForm.clientName}
									onChange={(event) =>
										setEditForm((previous) =>
											previous ? { ...previous, clientName: event.target.value } : previous
										)
									}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="edit-redirect-uris">Redirect URIs (one per line)</Label>
								<Textarea
									id="edit-redirect-uris"
									value={editForm.redirectUrisText}
									onChange={(event) =>
										setEditForm((previous) =>
											previous ? { ...previous, redirectUrisText: event.target.value } : previous
										)
									}
								/>
							</div>
							<ClientAccessSettings
								form={editForm}
								idPrefix="edit"
								onChange={(updater) =>
									setEditForm((previous) => (previous ? updater(previous) : previous))
								}
							/>
							<details className="rounded-lg border border-border/60 bg-card/40 px-3 py-3">
								<summary className="cursor-pointer text-sm font-medium text-foreground">
									Allowed Scopes
									<span className="ml-2 text-xs text-muted-foreground">
										{editForm.selectedScopes.size} selected of{' '}
										{scopeSections.reduce((total, section) => total + section.scopes.length, 0)}{' '}
										total
									</span>
								</summary>
								<div className="mt-4 space-y-4">
									{authPlatformSection ? (
										<Card className="border-border/60 bg-card/40">
											<CardHeader className="space-y-3 pb-3">
												<div className="flex flex-wrap items-center justify-between gap-3">
													<div>
														<CardTitle className="text-base">{authPlatformSection.label}</CardTitle>
														<CardDescription>{authPlatformSection.description}</CardDescription>
													</div>
													<div
														className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40"
														role="button"
														tabIndex={0}
														onClick={() =>
															setEditScopes(
																authPlatformOptionalScopeNames,
																!editAuthPlatformSelectionState.allSelected
															)
														}
														onKeyDown={(event) => {
															if (event.key === 'Enter' || event.key === ' ') {
																event.preventDefault()
																setEditScopes(
																	authPlatformOptionalScopeNames,
																	!editAuthPlatformSelectionState.allSelected
																)
															}
														}}
													>
														<Checkbox
															checked={
																editAuthPlatformSelectionState.allSelected
																	? true
																	: editAuthPlatformSelectionState.someSelected
																		? 'indeterminate'
																		: false
															}
															onClick={(event) => event.stopPropagation()}
															onCheckedChange={(checked) =>
																setEditScopes(authPlatformOptionalScopeNames, checked === true)
															}
														/>
														<span className="text-sm font-medium text-foreground">Select all</span>
														<Badge variant="ghost" className="text-xs">
															{editAuthPlatformSelectionState.selectedCount}/
															{authPlatformScopeNames.length}
														</Badge>
													</div>
												</div>
											</CardHeader>
											<CardContent>
												{renderScopeRows(
													authPlatformSection.scopes,
													editForm.selectedScopes,
													toggleEditScope
												)}
											</CardContent>
										</Card>
									) : null}
									{esiProxySection ? (
										<Card className="border-border/60 bg-card/40">
											<CardHeader className="space-y-3 pb-3">
												<div className="flex flex-wrap items-center justify-between gap-3">
													<div>
														<CardTitle className="text-base">{esiProxySection.label}</CardTitle>
														<CardDescription>{esiProxySection.description}</CardDescription>
													</div>
													<div className="flex flex-wrap items-center gap-2">
														{(['read', 'write'] as const).map((accessLevel) => {
															const selectionState =
																accessLevel === 'read'
																	? editEsiReadSelectionState
																	: editEsiWriteSelectionState
															const accessScopes =
																accessLevel === 'read' ? esiReadScopeNames : esiWriteScopeNames
															return (
																<div
																	key={accessLevel}
																	className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40"
																	role="button"
																	tabIndex={0}
																	onClick={() =>
																		setEditScopes(accessScopes, !selectionState.allSelected)
																	}
																	onKeyDown={(event) => {
																		if (event.key === 'Enter' || event.key === ' ') {
																			event.preventDefault()
																			setEditScopes(accessScopes, !selectionState.allSelected)
																		}
																	}}
																>
																	<Checkbox
																		checked={
																			selectionState.allSelected
																				? true
																				: selectionState.someSelected
																					? 'indeterminate'
																					: false
																		}
																		onClick={(event) => event.stopPropagation()}
																		onCheckedChange={(checked) =>
																			setEditScopes(accessScopes, checked === true)
																		}
																	/>
																	<span className="text-sm font-medium text-foreground">
																		Select all {accessLevel}
																	</span>
																	<Badge
																		variant={accessLevel === 'read' ? 'success' : 'warning'}
																		className="text-xs"
																	>
																		{selectionState.selectedCount}/{selectionState.totalCount}
																	</Badge>
																</div>
															)
														})}
													</div>
												</div>
											</CardHeader>
											<CardContent>
												<Accordion type="multiple" className="space-y-2">
													{esiProxySection.domainGroups.map((domainGroup) => (
														<AccordionItem
															key={domainGroup.key}
															value={domainGroup.key}
															className="rounded-lg border border-border/60 border-b-0 bg-background/40 px-3"
														>
															<AccordionTrigger className="py-3 text-sm font-medium text-foreground hover:no-underline">
																<span className="flex min-w-0 flex-1 items-center gap-2">
																	<span className="truncate">{domainGroup.label}</span>
																	<Badge
																		variant="ghost"
																		className="text-[10px] uppercase tracking-wide"
																	>
																		{domainGroup.scopes.length} scopes
																	</Badge>
																</span>
															</AccordionTrigger>
															<AccordionContent className="pb-0">
																<div className="pb-3">
																	{renderScopeRows(
																		domainGroup.scopes,
																		editForm.selectedScopes,
																		toggleEditScope
																	)}
																</div>
															</AccordionContent>
														</AccordionItem>
													))}
												</Accordion>
											</CardContent>
										</Card>
									) : null}
								</div>
							</details>
						</div>
					) : null}
					<DialogFooter>
						<Button variant="secondary" onClick={() => setEditDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							onClick={handleUpdate}
							loading={updateClientMutation.isPending}
							loadingText="Saving..."
						>
							Save Changes
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={secretDialogOpen} onOpenChange={setSecretDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New Client Secret</DialogTitle>
						<DialogDescription>
							This secret is only shown once. Copy it now and store it securely.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3">
						<SecretCopyRow
							label="Client ID"
							value={latestSecret?.clientId ?? ''}
							copied={secretCopiedField === 'clientId'}
							onCopy={() =>
								latestSecret?.clientId
									? void copySecretField(latestSecret.clientId, 'clientId', 'Client ID')
									: undefined
							}
						/>
						<SecretCopyRow
							label="Client Secret"
							value={latestSecret?.clientSecret ?? ''}
							copied={secretCopiedField === 'clientSecret'}
							onCopy={() =>
								latestSecret?.clientSecret
									? void copySecretField(latestSecret.clientSecret, 'clientSecret', 'Client Secret')
									: undefined
							}
						/>
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

function SecretCopyRow({
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
			<span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
			<div
				role="button"
				tabIndex={0}
				onClick={onCopy}
				onKeyDown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault()
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
				<span className="break-all font-mono text-base">{value}</span>
				{copied ? <Check className="h-4 w-4 shrink-0 text-teal-300" /> : null}
			</div>
		</div>
	)
}
