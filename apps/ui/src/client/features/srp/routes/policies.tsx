import { Edit2, Plus, Power, PowerOff } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Textarea } from '@/components/ui/textarea'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { useCreatePolicy, useSRPPolicies, useUpdatePolicy } from '../hooks'
import { formatISK } from '../utils'

import type { CapConfig, PayoutModifierConfig } from '@repo/srp'
import type { SRPPolicy } from '../types'

function isPayoutModifierConfig(c: unknown): c is PayoutModifierConfig {
	return typeof c === 'object' && c !== null && 'rate' in c
}

function isCapConfig(c: unknown): c is CapConfig {
	return typeof c === 'object' && c !== null && 'maxPayoutMillions' in c
}

export default function PoliciesPage() {
	const { hasPermission, isAdmin } = useUserPermissions()

	if (!(isAdmin || hasPermission('urn:srp:manager'))) {
		return <Navigate to="/srp" replace />
	}

	const { data: policies = [], isLoading } = useSRPPolicies()

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
			</div>
		</Container>
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
		<div>
			<div className="mb-4 flex items-start justify-between">
				<div>
					<h2 className="text-lg font-semibold">{title}</h2>
					<p className="text-sm text-muted-foreground">{description}</p>
				</div>
				<Button size="sm" onClick={() => setShowAddForm((v) => !v)}>
					<Plus className="mr-1 h-4 w-4" />
					Add Policy
				</Button>
			</div>

			{showAddForm && (
				<Card className="mb-4 p-4">
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
		</div>
	)
}

function PolicyRow({ policy }: { policy: SRPPolicy }) {
	const [editing, setEditing] = useState(false)
	const updateMutation = useUpdatePolicy()

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
				<td className="p-3 text-center">
					<span
						className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${policy.isActive ? 'bg-green-500/20 text-green-600' : 'bg-muted/40 text-muted-foreground'}`}
					>
						{policy.isActive ? 'Active' : 'Inactive'}
					</span>
				</td>
				<td className="p-3 text-right">
					<div className="flex items-center justify-end gap-1">
						<Button
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0"
							onClick={() => setEditing((v) => !v)}
						>
							<Edit2 className="h-4 w-4" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0"
							onClick={toggleActive}
							disabled={updateMutation.isPending}
						>
							{policy.isActive ? (
								<PowerOff className="h-4 w-4 text-muted-foreground" />
							) : (
								<Power className="h-4 w-4 text-green-500" />
							)}
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
					<Input
						id="policyOrder"
						type="number"
						value={displayOrder}
						onChange={(e) => setDisplayOrder(e.target.value)}
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
							<Input
								id="policyRate"
								type="number"
								min={0}
								max={200}
								value={rate}
								onChange={(e) => setRate(e.target.value)}
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
						<Input
							id="maxPayout"
							type="number"
							min={0}
							value={maxPayoutMillions}
							onChange={(e) => setMaxPayoutMillions(e.target.value)}
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

			<div className="flex gap-2">
				<Button variant="secondary" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button size="sm" onClick={handleSave} disabled={isPending}>
					{isPending ? 'Saving…' : existing ? 'Update Policy' : 'Create Policy'}
				</Button>
			</div>
		</div>
	)
}
