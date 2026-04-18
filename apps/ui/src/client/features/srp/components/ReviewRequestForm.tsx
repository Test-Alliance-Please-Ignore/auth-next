import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { useSRPPolicies, useSubmitReview } from '../hooks'
import { formatISK } from '../utils'
import { transformKillmailToFittingItems } from '../utils/fitting'
import { SRPFittingPanel } from './SRPFittingPanel'
import { SRPFittingSlotList } from './SRPFittingSlotList'

import type { CapConfig, PayoutModifierConfig } from '@repo/srp'
import type { AppliedModifier, SRPPolicy, SRPRequestResponse } from '../types'

interface ReviewRequestFormProps {
	request: SRPRequestResponse
	onSuccess: () => void
}

function isPayoutModifierConfig(c: unknown): c is PayoutModifierConfig {
	return typeof c === 'object' && c !== null && 'rate' in c
}

function isCapConfig(c: unknown): c is CapConfig {
	return typeof c === 'object' && c !== null && 'maxPayoutMillions' in c
}

function roundDownToMillion(isk: number): number {
	return Math.floor(isk / 1_000_000) * 1_000_000
}

// Payout computation — mirrors the backend logic
function computePayout(
	equipmentValue: number,
	netInsurance: number,
	modifierPolicy: SRPPolicy | null,
	capPolicy: SRPPolicy | null,
	modifiers: AppliedModifier[],
	overrideMillions: number | null
): number {
	if (overrideMillions !== null && overrideMillions > 0) {
		return overrideMillions * 1_000_000
	}

	let base = equipmentValue

	// Apply insurance delta
	if (modifierPolicy && isPayoutModifierConfig(modifierPolicy.config)) {
		if (modifierPolicy.config.applyInsuranceDelta) {
			base = Math.max(0, base - netInsurance)
		}
		base = base * parseFloat(modifierPolicy.config.rate)
	}

	// Apply ad-hoc modifiers
	for (const mod of modifiers) {
		if (mod.mode === 'percentage') {
			const factor = mod.modifierType === 'deduction' ? 1 - mod.amount / 100 : 1 + mod.amount / 100
			base = base * factor
		} else {
			const delta = mod.amount * 1_000_000
			base = mod.modifierType === 'deduction' ? base - delta : base + delta
		}
	}

	base = Math.max(0, base)

	// Apply cap
	if (capPolicy && isCapConfig(capPolicy.config)) {
		base = Math.min(base, capPolicy.config.maxPayoutMillions * 1_000_000)
	}

	return roundDownToMillion(base)
}

export function ReviewRequestForm({ request, onSuccess }: ReviewRequestFormProps) {
	const { data: policies = [] } = useSRPPolicies()
	const submitMutation = useSubmitReview()

	const modifierPolicies = policies.filter((p) => p.effect === 'payout_modifier' && p.isActive)
	const capPolicies = policies.filter((p) => p.effect === 'cap' && p.isActive)

	const [selectedModifierPolicyId, setSelectedModifierPolicyId] = useState<string | null>(null)
	const [selectedCapPolicyId, setSelectedCapPolicyId] = useState<string | null>(null)
	const [modifiers, setModifiers] = useState<AppliedModifier[]>([])
	const [overrideMillions, setOverrideMillions] = useState<number | null>(null)
	const [outcome, setOutcome] = useState<'approved' | 'needs_context' | 'rejected'>('approved')
	const [feedbackText, setFeedbackText] = useState('')
	const [reviewNotes, setReviewNotes] = useState('')
	const [showConfirm, setShowConfirm] = useState(false)

	const selectedModifierPolicy =
		modifierPolicies.find((p) => p.id === selectedModifierPolicyId) ?? null
	const selectedCapPolicy = capPolicies.find((p) => p.id === selectedCapPolicyId) ?? null

	const equipmentValue = parseFloat(request.srpEquipmentValue ?? request.shipValue ?? '0')
	const netInsurance = parseFloat(request.srpNetInsurance ?? '0')
	const insurancePremium = parseFloat(request.srpInsurancePremium ?? '0')
	const insurancePayout = parseFloat(request.srpInsurancePayout ?? '0')

	const computedPayout = computePayout(
		equipmentValue,
		netInsurance,
		selectedModifierPolicy,
		selectedCapPolicy,
		modifiers,
		overrideMillions
	)
	const isZeroPayout = computedPayout === 0

	// Build fitting items from srpItemPrices if available
	const fittingItems = request.srpItemPrices
		? transformKillmailToFittingItems(
				[],
				request.srpItemPrices.map((p) => ({ typeId: p.typeId, price: p.unitPrice }))
			)
		: []

	const applyInsurance =
		selectedModifierPolicy && isPayoutModifierConfig(selectedModifierPolicy.config)
			? selectedModifierPolicy.config.applyInsuranceDelta
			: false

	// Compute intermediate values for the math breakdown
	const afterInsurance = applyInsurance
		? Math.max(0, equipmentValue - netInsurance)
		: equipmentValue

	const coverageRate =
		selectedModifierPolicy && isPayoutModifierConfig(selectedModifierPolicy.config)
			? parseFloat(selectedModifierPolicy.config.rate)
			: null

	const afterCoverage = coverageRate !== null ? afterInsurance * coverageRate : afterInsurance

	let afterModifiers = afterCoverage
	const modifierLines: Array<{ label: string; amount: number }> = []
	for (const mod of modifiers) {
		let delta: number
		if (mod.mode === 'percentage') {
			delta = afterModifiers * (mod.amount / 100)
		} else {
			delta = mod.amount * 1_000_000
		}
		const signed = mod.modifierType === 'deduction' ? -delta : delta
		modifierLines.push({ label: mod.reason, amount: signed })
		afterModifiers = afterModifiers + signed
	}
	afterModifiers = Math.max(0, afterModifiers)

	const capPolicy =
		selectedCapPolicy && isCapConfig(selectedCapPolicy.config) ? selectedCapPolicy.config : null
	const isCapped = capPolicy !== null && afterModifiers > capPolicy.maxPayoutMillions * 1_000_000
	const beforeCapAmount = afterModifiers

	const addModifier = () => {
		setModifiers((prev) => [
			...prev,
			{
				id: crypto.randomUUID(),
				modifierType: 'deduction',
				mode: 'percentage',
				amount: 10,
				reason: '',
				computedAmountISK: '0',
			},
		])
	}

	const updateModifier = (id: string, updates: Partial<AppliedModifier>) => {
		setModifiers((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)))
	}

	const removeModifier = (id: string) => {
		setModifiers((prev) => prev.filter((m) => m.id !== id))
	}

	const handleSubmit = async () => {
		if (outcome === 'needs_context' || outcome === 'rejected') {
			if (!feedbackText.trim()) {
				toast.error(`Feedback is required for "${outcome.replace('_', ' ')}" outcome`)
				return
			}
		}

		if (!showConfirm) {
			setShowConfirm(true)
			return
		}

		// Compute computedAmountISK for each modifier before submitting
		let runningBase = applyInsurance ? Math.max(0, equipmentValue - netInsurance) : equipmentValue
		if (coverageRate !== null) runningBase *= coverageRate

		const finalModifiers: AppliedModifier[] = modifiers.map((mod) => {
			let impact: number
			if (mod.mode === 'percentage') {
				impact = runningBase * (mod.amount / 100)
			} else {
				impact = mod.amount * 1_000_000
			}
			const signed = mod.modifierType === 'deduction' ? -impact : impact
			runningBase = Math.max(0, runningBase + signed)
			return { ...mod, computedAmountISK: String(Math.round(Math.abs(impact))) }
		})

		try {
			await submitMutation.mutateAsync({
				id: request.id,
				data: {
					outcome,
					appliedModifierPolicyId: selectedModifierPolicyId,
					appliedCapPolicyId: selectedCapPolicyId,
					appliedModifiers: finalModifiers,
					reviewerOverrideMillions: overrideMillions,
					feedbackText: feedbackText.trim() || null,
					reviewNotes: reviewNotes.trim() || null,
				},
			})
			toast.success('Review submitted successfully')
			onSuccess()
		} catch (error: any) {
			toast.error('Failed to submit review', { description: error.message })
			setShowConfirm(false)
		}
	}

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{/* Left: Fitting display */}
			<div className="space-y-4">
				{request.shipTypeId && (
					<SRPFittingPanel
						shipTypeId={request.shipTypeId}
						shipTypeName={request.shipTypeName}
						items={fittingItems}
					/>
				)}
				{request.srpItemPrices && request.srpItemPrices.length > 0 && (
					<Card className="p-4">
						<h4 className="mb-3 font-semibold text-sm">Fitting</h4>
						<SRPFittingSlotList shipTypeId={request.shipTypeId} items={fittingItems} />
					</Card>
				)}
			</div>

			{/* Right: Review form */}
			<div className="space-y-4">
				{/* Math breakdown */}
				<Card className="p-4">
					<h4 className="mb-3 font-semibold text-sm">Payout Calculation</h4>
					<div className="space-y-1 font-mono text-sm">
						<MathRow label="Equipment Value" value={equipmentValue} />
						{applyInsurance && (
							<>
								<MathRow label="+ Insurance Cost" value={insurancePremium} dim />
								<MathRow label="− Insurance Payout" value={-insurancePayout} dim />
							</>
						)}
						<div className="my-1 border-t border-border/50" />
						<MathRow
							label="Base Value"
							value={applyInsurance ? afterInsurance : equipmentValue}
							bold
						/>
						{coverageRate !== null && (
							<>
								<div className="flex justify-between text-xs text-muted-foreground">
									<span>× Coverage Rate</span>
									<span>{Math.round(coverageRate * 100)}%</span>
								</div>
								<div className="my-1 border-t border-border/50" />
								<MathRow label="After Coverage" value={afterCoverage} bold />
							</>
						)}
						{modifierLines.map((line, i) => (
							<MathRow
								key={i}
								label={`${line.amount >= 0 ? '+' : '−'} ${line.label}`}
								value={Math.abs(line.amount)}
								dim
								sign={line.amount >= 0 ? '+' : '-'}
							/>
						))}
						{modifierLines.length > 0 && (
							<>
								<div className="my-1 border-t border-border/50" />
								<MathRow label="Before Cap" value={beforeCapAmount} bold />
							</>
						)}
						{capPolicy && (
							<div className="flex justify-between text-xs text-muted-foreground">
								<span>Cap ({selectedCapPolicy?.name})</span>
								<span className={isCapped ? 'text-amber-500' : ''}>
									{isCapped
										? `→ ${formatISK(String(capPolicy.maxPayoutMillions * 1_000_000))}`
										: 'none'}
								</span>
							</div>
						)}
						<div className="my-1 border-t-2 border-border" />
						<div className="flex justify-between font-bold">
							<span
								className={overrideMillions !== null ? 'line-through text-muted-foreground' : ''}
							>
								Suggested Payout
							</span>
							<span
								className={
									overrideMillions !== null
										? 'line-through text-muted-foreground'
										: isZeroPayout
											? 'text-destructive'
											: 'text-primary'
								}
							>
								{formatISK(String(computedPayout))}
							</span>
						</div>
						{overrideMillions !== null && (
							<div className="flex justify-between font-bold text-primary">
								<span>Override</span>
								<span>{formatISK(String(overrideMillions * 1_000_000))}</span>
							</div>
						)}
					</div>
				</Card>

				{/* Payout Modifier Policy */}
				{modifierPolicies.length > 0 && (
					<Card className="p-4">
						<h4 className="mb-3 text-sm font-semibold">Payout Modifier Policy</h4>
						<div className="space-y-2">
							<PolicyRadio
								label="None / Custom"
								selected={selectedModifierPolicyId === null}
								onSelect={() => setSelectedModifierPolicyId(null)}
								detail="No policy applied"
							/>
							{modifierPolicies.map((p) => {
								const cfg = isPayoutModifierConfig(p.config) ? p.config : null
								return (
									<PolicyRadio
										key={p.id}
										label={p.name}
										selected={selectedModifierPolicyId === p.id}
										onSelect={() => setSelectedModifierPolicyId(p.id)}
										detail={
											cfg
												? `${Math.round(parseFloat(cfg.rate) * 100)}% coverage${cfg.applyInsuranceDelta ? ', insurance deducted' : ', no insurance deduction'}`
												: ''
										}
									/>
								)
							})}
						</div>
					</Card>
				)}

				{/* Cap Policy */}
				{capPolicies.length > 0 && (
					<Card className="p-4">
						<h4 className="mb-3 text-sm font-semibold">Cap Policy</h4>
						<div className="space-y-2">
							<PolicyRadio
								label="No cap"
								selected={selectedCapPolicyId === null}
								onSelect={() => setSelectedCapPolicyId(null)}
								detail="No payout ceiling"
							/>
							{capPolicies.map((p) => {
								const cfg = isCapConfig(p.config) ? p.config : null
								return (
									<PolicyRadio
										key={p.id}
										label={p.name}
										selected={selectedCapPolicyId === p.id}
										onSelect={() => setSelectedCapPolicyId(p.id)}
										detail={
											cfg ? `Max: ${formatISK(String(cfg.maxPayoutMillions * 1_000_000))}` : ''
										}
									/>
								)
							})}
						</div>
					</Card>
				)}

				{/* Ad-hoc Modifiers */}
				<Card className="p-4">
					<h4 className="mb-3 text-sm font-semibold">Ad-hoc Modifiers</h4>
					<div className="space-y-2">
						{modifiers.map((mod) => (
							<div
								key={mod.id}
								className="flex items-center gap-2 rounded-md border border-border/40 p-2"
							>
								<div className="w-32">
									<Select
										value={mod.modifierType}
										onValueChange={(v) => updateModifier(mod.id, { modifierType: v as any })}
										options={[
											{ value: 'deduction', label: '− Deduction' },
											{ value: 'bonus', label: '+ Bonus' },
										]}
									/>
								</div>
								<div className="w-24">
									<Select
										value={mod.mode}
										onValueChange={(v) => updateModifier(mod.id, { mode: v as any })}
										options={[
											{ value: 'percentage', label: '%' },
											{ value: 'value', label: 'M ISK' },
										]}
									/>
								</div>
								<Input
									type="number"
									min={0}
									value={mod.amount}
									onChange={(e) =>
										updateModifier(mod.id, { amount: parseFloat(e.target.value) || 0 })
									}
									className="h-9 w-20"
								/>
								<Input
									placeholder="Reason (required)"
									value={mod.reason}
									onChange={(e) => updateModifier(mod.id, { reason: e.target.value })}
									className="h-9 flex-1"
								/>
								<Button
									variant="ghost"
									size="sm"
									className="h-9 w-9 p-0"
									onClick={() => removeModifier(mod.id)}
								>
									<X className="h-4 w-4" />
								</Button>
							</div>
						))}
						<Button variant="secondary" size="sm" onClick={addModifier}>
							<Plus className="mr-1 h-4 w-4" /> Add Modifier
						</Button>
					</div>
				</Card>

				{/* Override */}
				<Card className="p-4">
					<h4 className="mb-2 text-sm font-semibold">Override Payout</h4>
					<div className="flex items-center gap-2">
						<Input
							type="number"
							min={0}
							placeholder="millions"
							value={overrideMillions ?? ''}
							onChange={(e) => {
								const v = e.target.value
								setOverrideMillions(v === '' ? null : parseInt(v, 10) || null)
							}}
							className="w-32"
						/>
						<span className="text-sm text-muted-foreground">
							× 1,000,000 ISK
							{overrideMillions !== null
								? ` = ${formatISK(String(overrideMillions * 1_000_000))}`
								: ''}
						</span>
					</div>
				</Card>

				{/* Feedback text */}
				<Card className="p-4">
					<Label htmlFor="feedbackText" className="mb-2 block text-sm font-semibold">
						Feedback to Pilot
						{outcome === 'needs_context' || outcome === 'rejected' ? ' *' : ' (optional)'}
					</Label>
					<Textarea
						id="feedbackText"
						value={feedbackText}
						onChange={(e) => setFeedbackText(e.target.value)}
						placeholder={
							outcome === 'needs_context'
								? 'What additional information is needed?'
								: outcome === 'rejected'
									? 'Explain the reason for rejection...'
									: 'Add a note to the pilot (optional)...'
						}
						rows={3}
					/>
					<p className="mt-1 text-xs text-muted-foreground">
						Posted as a public comment on the request
					</p>
				</Card>

				{/* Internal notes */}
				<Card className="p-4">
					<Label htmlFor="reviewNotes" className="mb-2 block text-sm font-semibold">
						Internal Notes (optional)
					</Label>
					<Textarea
						id="reviewNotes"
						value={reviewNotes}
						onChange={(e) => setReviewNotes(e.target.value)}
						placeholder="Notes for other reviewers (not visible to pilot)..."
						rows={3}
					/>
				</Card>

				{/* Outcome + Submit */}
				<Card className="p-4">
					<div className="mb-4 flex items-center gap-3">
						<Label className="text-sm font-semibold">Outcome</Label>
						<div className="flex-1">
							<Select
								value={outcome}
								onValueChange={(v) => {
									setOutcome(v as any)
									setShowConfirm(false)
								}}
								options={[
									{
										value: 'approved',
										label:
											isZeroPayout && overrideMillions === null
												? 'Approved (payout is zero — must reject)'
												: 'Approved',
									},
									{ value: 'needs_context', label: 'Needs Context' },
									{ value: 'rejected', label: 'Rejected' },
								].filter(
									(opt) => !(opt.value === 'approved' && isZeroPayout && overrideMillions === null)
								)}
							/>
						</div>
					</div>

					{showConfirm && (
						<div className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-600">
							Confirm submission: <strong>{outcome.replace('_', ' ')}</strong> for{' '}
							{request.shipTypeName}? Payout:{' '}
							<strong>
								{overrideMillions !== null
									? formatISK(String(overrideMillions * 1_000_000))
									: formatISK(String(computedPayout))}
							</strong>
						</div>
					)}

					<div className="flex gap-2">
						{showConfirm && (
							<Button variant="secondary" size="sm" onClick={() => setShowConfirm(false)}>
								Back
							</Button>
						)}
						<Button
							className="flex-1"
							onClick={handleSubmit}
							disabled={
								submitMutation.isPending ||
								(isZeroPayout && outcome === 'approved' && overrideMillions === null)
							}
						>
							{submitMutation.isPending
								? 'Submitting…'
								: showConfirm
									? 'Confirm Submit'
									: 'Submit Review'}
						</Button>
					</div>
				</Card>
			</div>
		</div>
	)
}

function MathRow({
	label,
	value,
	bold,
	dim,
	sign,
}: {
	label: string
	value: number
	bold?: boolean
	dim?: boolean
	sign?: '+' | '-'
}) {
	const cls = dim ? 'text-muted-foreground text-xs' : bold ? 'font-semibold' : ''
	return (
		<div className={`flex justify-between ${cls}`}>
			<span>{label}</span>
			<span>
				{sign}
				{formatISK(String(Math.round(value)))}
			</span>
		</div>
	)
}

function PolicyRadio({
	label,
	selected,
	onSelect,
	detail,
}: {
	label: string
	selected: boolean
	onSelect: () => void
	detail: string
}) {
	return (
		<label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/40 p-2 hover:bg-muted/20 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/10">
			<input
				type="radio"
				checked={selected}
				onChange={onSelect}
				className="mt-0.5 h-4 w-4 accent-primary"
			/>
			<div>
				<p className="text-sm font-medium">{label}</p>
				{detail && <p className="text-xs text-muted-foreground">{detail}</p>}
			</div>
		</label>
	)
}
