import { Edit2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'

import {
	useCreatePolicy,
	useDeletePolicy,
	useSRPConfig,
	useSRPPolicies,
	useUpdatePolicy,
	useUpdateSRPConfig,
} from '../hooks'
import { formatISK } from '../utils'

import type { CapConfig, PayoutModifierConfig } from '@repo/srp'
import type { SelectOption } from '@/components/ui/select'
import type { SRPConfigResponse, SRPPolicy, SRPPredefinedAdhocModifier } from '../types'

function isPayoutModifierConfig(c: unknown): c is PayoutModifierConfig {
	return typeof c === 'object' && c !== null && 'rate' in c
}

function isCapConfig(c: unknown): c is CapConfig {
	return typeof c === 'object' && c !== null && 'maxPayoutMillions' in c
}

function upsertSelectOption(
	current: SelectOption[],
	next: SelectOption,
	limit = 50
): SelectOption[] {
	const without = current.filter((option) => option.value !== next.value)
	return [next, ...without].slice(0, limit)
}

function formatTemplateAmount(modifier: SRPPredefinedAdhocModifier): string {
	if (modifier.mode === 'percentage') {
		return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(modifier.amount)}%`
	}

	return formatISK(String(Math.round(modifier.amount * 1_000_000)))
}

export default function PoliciesPage() {
	usePageTitle('SRP - Policies')

	const { hasPermission, isAdmin } = useUserPermissions()

	if (!(isAdmin || hasPermission('urn:srp:manager'))) {
		return <Navigate to="/srp" replace />
	}

	const { data: policies = [], isLoading } = useSRPPolicies()
	const { data: config } = useSRPConfig()

	const modifierPolicies = policies.filter((p) => p.effect === 'payout_modifier')
	const capPolicies = policies.filter((p) => p.effect === 'cap')

	if (isLoading) {
		return (
			<Container>
				<PageHeader title="SRP Policies" description="Manage payout modifier and cap policies" />
				<div className="space-y-4">
					{[...Array(4)].map((_, i) => (
						<div key={i} className="h-14 animate-pulse rounded-md bg-muted/30" />
					))}
				</div>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title="SRP Policies"
				description="Manage payout modifier and cap policies used during reviews"
			/>

			<div className="space-y-8">
				<GeneralConfigPanel config={config} />
				<PolicySection
					title="Payout Modifier Policies"
					description="Control coverage rate and insurance handling"
					effect="payout_modifier"
					policies={modifierPolicies}
				/>
				<PolicySection
					title="Cap Policies"
					description="Set payout ceilings"
					effect="cap"
					policies={capPolicies}
				/>
				<PredefinedAdhocModifiersSection
					initialModifiers={config?.predefinedAdhocModifiers ?? []}
				/>
			</div>
		</Container>
	)
}

function GeneralConfigPanel({ config }: { config?: SRPConfigResponse }) {
	const updateConfigMutation = useUpdateSRPConfig()
	const [defaultCoverageRatePercent, setDefaultCoverageRatePercent] = useState('100')
	const [maxPayoutAmount, setMaxPayoutAmount] = useState('')
	const [maxLossAgeDays, setMaxLossAgeDays] = useState('30')
	const [paymentProcessorCorporationId, setPaymentProcessorCorporationId] = useState('')
	const [srpGroupId, setSrpGroupId] = useState('')
	const [paymentProcessorCorporationOptions, setPaymentProcessorCorporationOptions] = useState<
		SelectOption[]
	>([])
	const [srpGroupOptions, setSrpGroupOptions] = useState<SelectOption[]>([])

	useEffect(() => {
		if (!config) return
		setDefaultCoverageRatePercent(String(Math.round(parseFloat(config.defaultCoverageRate) * 100)))
		setMaxPayoutAmount(config.maxPayoutAmount ?? '')
		setMaxLossAgeDays(String(config.maxLossAgeDays))
		setPaymentProcessorCorporationId(config.paymentProcessorCorporationId ?? '')
		setSrpGroupId(config.srpGroupId ?? '')
	}, [config])

	useEffect(() => {
		if (!paymentProcessorCorporationId) {
			return
		}

		let cancelled = false
		void api
			.searchSRPPaymentProcessorCorporations(paymentProcessorCorporationId)
			.then((rows) => {
				if (cancelled) return
				const matched = rows.find((row) => row.corporationId === paymentProcessorCorporationId)
				const option = matched
					? ({
							value: matched.corporationId,
							label: `${matched.name} (${matched.corporationId})`,
						} satisfies SelectOption)
					: ({
							value: paymentProcessorCorporationId,
							label: paymentProcessorCorporationId,
						} satisfies SelectOption)
				setPaymentProcessorCorporationOptions((current) => upsertSelectOption(current, option))
			})
			.catch(() => {
				if (!cancelled) {
					setPaymentProcessorCorporationOptions((current) =>
						upsertSelectOption(current, {
							value: paymentProcessorCorporationId,
							label: paymentProcessorCorporationId,
						})
					)
				}
			})

		return () => {
			cancelled = true
		}
	}, [paymentProcessorCorporationId])

	useEffect(() => {
		if (!srpGroupId) {
			return
		}

		let cancelled = false
		void api
			.getGroup(srpGroupId)
			.then((group) => {
				if (cancelled) return
				setSrpGroupOptions((current) =>
					upsertSelectOption(current, {
						value: group.id,
						label: `${group.name} (${group.id})`,
					})
				)
			})
			.catch(() => {
				if (!cancelled) {
					setSrpGroupOptions((current) =>
						upsertSelectOption(current, {
							value: srpGroupId,
							label: srpGroupId,
						})
					)
				}
			})

		return () => {
			cancelled = true
		}
	}, [srpGroupId])

	const save = async () => {
		try {
			await updateConfigMutation.mutateAsync({
				defaultCoverageRate: String((Number.parseFloat(defaultCoverageRatePercent) || 0) / 100),
				maxPayoutAmount: maxPayoutAmount.trim() ? maxPayoutAmount.trim() : null,
				maxLossAgeDays: Math.max(1, Number.parseInt(maxLossAgeDays, 10) || 30),
				paymentProcessorCorporationId: paymentProcessorCorporationId.trim()
					? paymentProcessorCorporationId.trim()
					: null,
				srpGroupId: srpGroupId.trim() ? srpGroupId.trim() : null,
			} as any)
			toast.success('SRP configuration saved')
		} catch (error: any) {
			toast.error('Failed to save SRP configuration', { description: error.message })
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">General Configuration</CardTitle>
				<CardDescription>
					Edit SRP baseline configuration values used across request handling and review.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<div>
						<Label htmlFor="defaultCoverageRatePercent">Default Coverage Rate (%)</Label>
						<NumberInput
							id="defaultCoverageRatePercent"
							min={0}
							max={200}
							step={1}
							allowDecimal={false}
							suffix="%"
							value={defaultCoverageRatePercent}
							onChange={setDefaultCoverageRatePercent}
						/>
					</div>
					<div>
						<Label htmlFor="maxPayoutAmount">Max Payout Amount (ISK, optional)</Label>
						<NumberInput
							id="maxPayoutAmount"
							min={0}
							step={1}
							allowDecimal={false}
							suffix=" ISK"
							value={maxPayoutAmount}
							onChange={setMaxPayoutAmount}
							placeholder="e.g. 1,000,000,000 ISK"
						/>
					</div>
					<div>
						<Label htmlFor="maxLossAgeDays">Max Loss Age (days)</Label>
						<NumberInput
							id="maxLossAgeDays"
							min={1}
							step={1}
							allowDecimal={false}
							value={maxLossAgeDays}
							onChange={setMaxLossAgeDays}
						/>
					</div>
					<div className="sm:col-span-2">
						<Label htmlFor="paymentProcessorCorporationId">Payment Processor Corporation</Label>
						<Select
							inputId="paymentProcessorCorporationId"
							searchable
							value={paymentProcessorCorporationId}
							onValueChange={(next, option) => {
								setPaymentProcessorCorporationId(next)
								if (option) {
									setPaymentProcessorCorporationOptions((current) =>
										upsertSelectOption(current, { value: option.value, label: option.label })
									)
								}
							}}
							options={paymentProcessorCorporationOptions}
							placeholder="Search managed corporations..."
							queryHintText="Type at least 2 characters to search managed corporations"
							searchDelegate={(query) =>
								api.searchSRPPaymentProcessorCorporations(query).then((rows) =>
									rows.map((row) => ({
										value: row.corporationId,
										label: `${row.name} (${row.corporationId})`,
									}))
								)
							}
						/>
					</div>
					<div className="sm:col-span-2">
						<Label htmlFor="srpGroupId">SRP Group</Label>
						<Select
							inputId="srpGroupId"
							searchable
							value={srpGroupId}
							onValueChange={(next, option) => {
								setSrpGroupId(next)
								if (option) {
									setSrpGroupOptions((current) =>
										upsertSelectOption(current, { value: option.value, label: option.label })
									)
								}
							}}
							options={srpGroupOptions}
							placeholder="Search groups..."
							queryHintText="Type at least 2 characters to search groups"
							searchDelegate={(query) =>
								api.getGroups({ search: query, limit: 25 }).then((rows) =>
									rows.map((row) => ({
										value: row.id,
										label: `${row.name} (${row.id})`,
									}))
								)
							}
						/>
					</div>
				</div>

				<div className="flex justify-end">
					<div className="flex items-center gap-2">
						<Button onClick={save} disabled={updateConfigMutation.isPending}>
						{updateConfigMutation.isPending ? 'Saving…' : 'Save Configuration'}
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

function PredefinedAdhocModifiersSection({
	initialModifiers,
}: {
	initialModifiers: SRPPredefinedAdhocModifier[]
}) {
	const updateConfigMutation = useUpdateSRPConfig()
	const [modifiers, setModifiers] = useState<SRPPredefinedAdhocModifier[]>(initialModifiers)
	const [editingIndex, setEditingIndex] = useState<number | null>(null)
	const [isCreating, setIsCreating] = useState(false)
	const [draftModifier, setDraftModifier] = useState<SRPPredefinedAdhocModifier | null>(null)

	useEffect(() => {
		setModifiers(initialModifiers)
		setEditingIndex(null)
		setIsCreating(false)
		setDraftModifier(null)
	}, [initialModifiers])

	const persistModifiers = async (nextModifiers: SRPPredefinedAdhocModifier[]) => {
		try {
			await updateConfigMutation.mutateAsync({
				predefinedAdhocModifiers: nextModifiers.map((modifier) => ({
					...modifier,
					reason: modifier.reason.trim(),
				})),
			} as any)
		} catch (error: any) {
			toast.error('Failed to save predefined modifiers', { description: error.message })
		}
	}

	const addModifier = () => {
		setEditingIndex(modifiers.length)
		setIsCreating(true)
		setDraftModifier({
			modifierType: 'deduction',
			mode: 'percentage',
			amount: 10,
			reason: '',
		})
	}

	const startEdit = (index: number) => {
		setEditingIndex(index)
		setIsCreating(false)
		setDraftModifier({ ...modifiers[index] })
	}

	const cancelEdit = () => {
		setEditingIndex(null)
		setIsCreating(false)
		setDraftModifier(null)
	}

	const saveEdit = async () => {
		if (editingIndex === null || !draftModifier) return
		if (draftModifier.reason.trim().length === 0) {
			toast.error('Reason is required')
			return
		}

		const cleaned = { ...draftModifier, reason: draftModifier.reason.trim() }
		const next = isCreating
			? [...modifiers, cleaned]
			: modifiers.map((modifier, index) => (index === editingIndex ? cleaned : modifier))

		setModifiers(next)
		setEditingIndex(null)
		setIsCreating(false)
		setDraftModifier(null)
		await persistModifiers(next)
	}

	const removeModifier = (index: number) => {
		const next = modifiers.filter((_, currentIndex) => currentIndex !== index)
		setModifiers(next)
		void persistModifiers(next)
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
				<div>
					<CardTitle className="text-lg">Modifier Templates</CardTitle>
					<CardDescription>
						Optional suggestion templates shown in review form ad-hoc modifiers.
					</CardDescription>
				</div>
				<Button size="sm" onClick={addModifier} disabled={updateConfigMutation.isPending}>
					<Plus className="mr-1 h-4 w-4" />
					Add Template
				</Button>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="overflow-hidden rounded-lg border border-border/50 bg-card">
				{modifiers.length === 0 && !(isCreating && draftModifier && editingIndex === modifiers.length) ? (
					<div className="p-8 text-center text-sm text-muted-foreground">No modifiers yet</div>
				) : (
					<div className="space-y-2 p-3">
						<div className="grid items-center gap-2 px-2 text-xs font-medium text-muted-foreground sm:grid-cols-[150px_140px_140px_1fr_auto]">
							<div>Type</div>
							<div>Mode</div>
							<div>Amount</div>
							<div>Reason</div>
							<div className="text-right">Actions</div>
						</div>
						{modifiers.map((modifier, index) => (
							<div
								key={index}
								className="grid items-center gap-2 rounded-md border border-border/40 p-3 sm:grid-cols-[150px_140px_140px_1fr_auto]"
							>
								{editingIndex === index && !isCreating && draftModifier ? (
									<>
										<Select
											value={draftModifier.modifierType}
											onValueChange={(value) =>
												setDraftModifier({
													...draftModifier,
													modifierType: value as SRPPredefinedAdhocModifier['modifierType'],
												})
											}
											options={[
												{ value: 'deduction', label: 'Deduction' },
												{ value: 'bonus', label: 'Bonus' },
											]}
										/>
										<Select
											value={draftModifier.mode}
											onValueChange={(value) =>
												setDraftModifier({
													...draftModifier,
													mode: value as SRPPredefinedAdhocModifier['mode'],
												})
											}
											options={[
												{ value: 'percentage', label: 'Percentage' },
												{ value: 'value', label: 'M ISK' },
											]}
										/>
										<NumberInput
											min={0}
											step={0.01}
											value={draftModifier.amount}
											onChange={(value) =>
												setDraftModifier({
													...draftModifier,
													amount: Number.parseFloat(value) || 0,
												})
											}
											placeholder="Amount"
										/>
										<Input
											value={draftModifier.reason}
											onChange={(e) =>
												setDraftModifier({
													...draftModifier,
													reason: e.target.value,
												})
											}
											placeholder="Reason"
										/>
										<div className="flex gap-1">
											<Button variant="primary" size="sm" onClick={() => void saveEdit()}>
												Save
											</Button>
											<Button variant="ghost" size="sm" onClick={cancelEdit}>
												Cancel
											</Button>
										</div>
									</>
								) : (
									<>
										<div className="text-sm">
											<Badge
												variant={modifier.modifierType === 'deduction' ? 'destructive' : 'default'}
												className={modifier.modifierType === 'bonus' ? 'bg-green-600 text-white' : undefined}
											>
												{modifier.modifierType === 'deduction' ? 'Deduction' : 'Bonus'}
											</Badge>
										</div>
										<div className="text-sm font-semibold">
											{modifier.mode === 'percentage' ? 'Percentage' : 'M ISK'}
										</div>
										<div className="font-mono font-semibold text-sm tabular-nums">
											{formatTemplateAmount(modifier)}
										</div>
										<div className="text-sm">{modifier.reason}</div>
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => startEdit(index)}
												disabled={updateConfigMutation.isPending}
												aria-label="Edit template"
											>
												<Pencil className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => removeModifier(index)}
												disabled={updateConfigMutation.isPending}
												aria-label="Remove template"
												className="text-destructive hover:text-destructive"
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
									</>
								)}
							</div>
						))}
						{isCreating && draftModifier && editingIndex === modifiers.length && (
							<div className="grid items-center gap-2 rounded-md border border-border/40 p-3 sm:grid-cols-[150px_140px_140px_1fr_auto]">
								<Select
									value={draftModifier.modifierType}
									onValueChange={(value) =>
										setDraftModifier({
											...draftModifier,
											modifierType: value as SRPPredefinedAdhocModifier['modifierType'],
										})
									}
									options={[
										{ value: 'deduction', label: 'Deduction' },
										{ value: 'bonus', label: 'Bonus' },
									]}
								/>
								<Select
									value={draftModifier.mode}
									onValueChange={(value) =>
										setDraftModifier({
											...draftModifier,
											mode: value as SRPPredefinedAdhocModifier['mode'],
										})
									}
									options={[
										{ value: 'percentage', label: 'Percentage' },
										{ value: 'value', label: 'M ISK' },
									]}
								/>
								<NumberInput
									min={0}
									step={0.01}
									value={draftModifier.amount}
									onChange={(value) =>
										setDraftModifier({
											...draftModifier,
											amount: Number.parseFloat(value) || 0,
										})
									}
									placeholder="Amount"
								/>
								<Input
									value={draftModifier.reason}
									onChange={(e) =>
										setDraftModifier({
											...draftModifier,
											reason: e.target.value,
										})
									}
									placeholder="Reason"
								/>
								<div className="flex gap-1">
									<Button variant="primary" size="sm" onClick={() => void saveEdit()}>
										Save
									</Button>
									<Button variant="ghost" size="sm" onClick={cancelEdit}>
										Cancel
									</Button>
								</div>
							</div>
						)}
					</div>
				)}
				</div>
			</CardContent>
		</Card>
	)
}

interface PolicySectionProps {
	title: string
	description: string
	effect: 'payout_modifier' | 'cap'
	policies: SRPPolicy[]
}

function PolicySection({ title, description, effect, policies }: PolicySectionProps) {
	const [showAddForm, setShowAddForm] = useState(false)

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
				<div>
					<CardTitle className="text-lg">{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</div>
				<Button size="sm" onClick={() => setShowAddForm((v) => !v)}>
					<Plus className="mr-1 h-4 w-4" />
					Add Policy
				</Button>
			</CardHeader>
			<CardContent className="space-y-4">
				{showAddForm && (
					<Card className="p-4">
						<PolicyForm
							effect={effect}
							onCancel={() => setShowAddForm(false)}
							onSaved={() => setShowAddForm(false)}
						/>
					</Card>
				)}

				<div className="overflow-hidden rounded-lg border border-border/50 bg-card">
				{policies.length === 0 ? (
					<div className="p-8 text-center text-sm text-muted-foreground">No policies yet</div>
				) : (
					<table className="w-full">
						<thead>
							<tr className="border-b border-border/50 bg-muted/20">
								<th className="p-3 text-left text-xs font-semibold text-muted-foreground">Name</th>
								{effect === 'payout_modifier' ? (
									<>
										<th className="p-3 text-left text-xs font-semibold text-muted-foreground">
											Rate
										</th>
										<th className="p-3 text-left text-xs font-semibold text-muted-foreground">
											Insurance
										</th>
									</>
								) : (
									<th className="p-3 text-left text-xs font-semibold text-muted-foreground">
										Max Payout
									</th>
								)}
								<th className="p-3 text-center text-xs font-semibold text-muted-foreground">
									Order
								</th>
								<th className="p-3 text-center text-xs font-semibold text-muted-foreground">
									Active
								</th>
								<th className="p-3 text-right text-xs font-semibold text-muted-foreground">
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{policies.map((policy) => (
								<PolicyRow key={policy.id} policy={policy} />
							))}
						</tbody>
					</table>
				)}
			</div>
			</CardContent>
		</Card>
	)
}

function PolicyRow({ policy }: { policy: SRPPolicy }) {
	const [editing, setEditing] = useState(false)
	const updateMutation = useUpdatePolicy()
	const deleteMutation = useDeletePolicy()

	const toggleActive = async () => {
		try {
			await updateMutation.mutateAsync({
				id: policy.id,
				data: { ...policy, isActive: !policy.isActive } as any,
			})
			toast.success(policy.isActive ? 'Policy deactivated' : 'Policy activated')
		} catch (e: any) {
			toast.error('Failed to update policy', { description: e.message })
		}
	}

	const removePolicy = async () => {
		if (!confirm('Delete this policy? This action cannot be undone.')) return

		try {
			await deleteMutation.mutateAsync(policy.id)
			toast.success('Policy deleted')
		} catch (e: any) {
			toast.error('Failed to delete policy', { description: e.message })
		}
	}

	return (
		<>
			<tr className="border-b border-border/30 hover:bg-muted/10">
				<td className="p-3">
					<div className="font-medium text-sm">{policy.name}</div>
					{policy.description && (
						<div className="text-xs text-muted-foreground">{policy.description}</div>
					)}
				</td>
				{policy.effect === 'payout_modifier' && isPayoutModifierConfig(policy.config) ? (
					<>
						<td className="p-3 text-sm">{Math.round(parseFloat(policy.config.rate) * 100)}%</td>
						<td className="p-3 text-sm text-muted-foreground">
							{policy.config.applyInsuranceDelta ? 'Deducted' : 'Not deducted'}
						</td>
					</>
				) : policy.effect === 'cap' && isCapConfig(policy.config) ? (
					<td className="p-3 text-sm font-mono">
						{formatISK(String(policy.config.maxPayoutMillions * 1_000_000))}
					</td>
				) : null}
				<td className="p-3 text-center text-sm">{policy.displayOrder}</td>
				<td className="p-3">
					<div className="flex items-center justify-center gap-2">
						<Switch
							checked={policy.isActive}
							onCheckedChange={() => void toggleActive()}
							disabled={updateMutation.isPending}
						/>
						<span className="text-xs text-muted-foreground">
							{policy.isActive ? 'Active' : 'Inactive'}
						</span>
					</div>
				</td>
				<td className="p-3 text-right">
					<div className="flex items-center justify-end gap-1">
						<Button
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0"
							onClick={() => setEditing((v) => !v)}
							disabled={deleteMutation.isPending}
						>
							<Edit2 className="h-4 w-4" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0 text-destructive hover:text-destructive"
							onClick={() => void removePolicy()}
							disabled={deleteMutation.isPending || updateMutation.isPending}
							aria-label="Delete policy"
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
				</td>
			</tr>
			{editing && (
				<tr className="border-b border-border/30 bg-muted/5">
					<td colSpan={7} className="p-4">
						<PolicyForm
							effect={policy.effect}
							existing={policy}
							onCancel={() => setEditing(false)}
							onSaved={() => setEditing(false)}
						/>
					</td>
				</tr>
			)}
		</>
	)
}

interface PolicyFormProps {
	effect: 'payout_modifier' | 'cap'
	existing?: SRPPolicy
	onCancel: () => void
	onSaved: () => void
}

function PolicyForm({ effect, existing, onCancel, onSaved }: PolicyFormProps) {
	const createMutation = useCreatePolicy()
	const updateMutation = useUpdatePolicy()

	const existingModConfig =
		existing && isPayoutModifierConfig(existing.config) ? existing.config : null
	const existingCapConfig = existing && isCapConfig(existing.config) ? existing.config : null

	const [name, setName] = useState(existing?.name ?? '')
	const [description, setDescription] = useState(existing?.description ?? '')
	const [displayOrder, setDisplayOrder] = useState(String(existing?.displayOrder ?? 0))

	// Payout modifier fields
	const [rate, setRate] = useState(
		existingModConfig ? String(Math.round(parseFloat(existingModConfig.rate) * 100)) : '100'
	)
	const [applyInsurance, setApplyInsurance] = useState(
		existingModConfig?.applyInsuranceDelta ?? true
	)

	// Cap fields
	const [maxPayoutMillions, setMaxPayoutMillions] = useState(
		String(existingCapConfig?.maxPayoutMillions ?? 300)
	)

	const isPending = createMutation.isPending || updateMutation.isPending

	const handleSave = async () => {
		if (!name.trim()) {
			toast.error('Name is required')
			return
		}

		const config =
			effect === 'payout_modifier'
				? { rate: String(parseInt(rate, 10) / 100), applyInsuranceDelta: applyInsurance }
				: { maxPayoutMillions: parseInt(maxPayoutMillions, 10) }

		const data = {
			name: name.trim(),
			description: description.trim() || undefined,
			effect,
			config,
			displayOrder: parseInt(displayOrder, 10) || 0,
		}

		try {
			if (existing) {
				await updateMutation.mutateAsync({ id: existing.id, data: data as any })
				toast.success('Policy updated')
			} else {
				await createMutation.mutateAsync(data as any)
				toast.success('Policy created')
			}
			onSaved()
		} catch (e: any) {
			toast.error('Failed to save policy', { description: e.message })
		}
	}

	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2">
				<div>
					<Label htmlFor="policyName">Name *</Label>
					<Input
						id="policyName"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g. Fleet blanket 100%"
					/>
				</div>
				<div>
					<Label htmlFor="policyOrder">Display Order</Label>
					<NumberInput
						id="policyOrder"
						step={1}
						allowDecimal={false}
						value={displayOrder}
						onChange={setDisplayOrder}
					/>
				</div>
				<div className="sm:col-span-2">
					<Label htmlFor="policyDesc">Description (optional)</Label>
					<Textarea
						id="policyDesc"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						rows={2}
					/>
				</div>

				{effect === 'payout_modifier' ? (
					<>
						<div>
							<Label htmlFor="policyRate">Coverage Rate (%)</Label>
							<NumberInput
								id="policyRate"
								min={0}
								max={200}
								step={1}
								allowDecimal={false}
								suffix="%"
								value={rate}
								onChange={setRate}
								placeholder="100"
							/>
							<p className="mt-1 text-xs text-muted-foreground">
								100 = full value, 80 = 80%, 110 = 110%
							</p>
						</div>
						<div className="flex items-center gap-3 pt-6">
							<input
								id="applyInsurance"
								type="checkbox"
								checked={applyInsurance}
								onChange={(e) => setApplyInsurance(e.target.checked)}
								className="h-4 w-4"
							/>
							<Label htmlFor="applyInsurance">Deduct insurance from payout</Label>
						</div>
					</>
				) : (
					<div>
						<Label htmlFor="maxPayout">Max Payout (millions ISK)</Label>
						<NumberInput
							id="maxPayout"
							min={0}
							step={1}
							allowDecimal={false}
							value={maxPayoutMillions}
							onChange={setMaxPayoutMillions}
							placeholder="300"
						/>
						<p className="mt-1 text-xs text-muted-foreground">
							{maxPayoutMillions
								? `= ${formatISK(String(parseInt(maxPayoutMillions, 10) * 1_000_000))}`
								: ''}
						</p>
					</div>
				)}
			</div>

			<div className="flex justify-end gap-2">
				<Button variant="cancel" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button size="sm" onClick={handleSave} disabled={isPending}>
					{isPending ? 'Saving…' : existing ? 'Update Policy' : 'Create Policy'}
				</Button>
			</div>
		</div>
	)
}
