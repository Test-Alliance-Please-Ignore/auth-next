/**
 * Fitting Form Component
 *
 * Form for creating or editing a fitting with EFT textarea and preview
 */

import { useState } from 'react'

import { CancelButton } from '@/components/ui/cancel-button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { validateEFT } from '../utils'
import { EftPreview } from './EftPreview'

import type { CreateFittingRequest, Fitting, UpdateFittingRequest } from '../types'

interface FittingFormProps {
	fitting?: Fitting
	onSubmit: (data: CreateFittingRequest | UpdateFittingRequest) => void | Promise<void>
	onCancel: () => void
	isSubmitting?: boolean
}

export function FittingForm({ fitting, onSubmit, onCancel, isSubmitting }: FittingFormProps) {
	const [eftString, setEftString] = useState(fitting?.fitting || '')
	const [category, setCategory] = useState(fitting?.category || '')
	const [maintainer, setMaintainer] = useState(fitting?.maintainer || '')
	const [srpEligible, setSrpEligible] = useState(fitting?.srpEligible || false)
	const [srpValue, setSrpValue] = useState(fitting?.srpValue || '0')
	const [showPreview, setShowPreview] = useState(false)
	const [eftError, setEftError] = useState<string | null>(null)

	const handleEftChange = (value: string) => {
		setEftString(value)
		setEftError(null)
		setShowPreview(false)
	}

	const handleEftBlur = () => {
		if (eftString.trim()) {
			const validation = validateEFT(eftString)
			if (validation.valid) {
				setShowPreview(true)
			} else {
				setEftError(validation.error || 'Invalid EFT format')
			}
		}
	}

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()

		// Validate EFT before submitting
		const validation = validateEFT(eftString)
		if (!validation.valid) {
			setEftError(validation.error || 'Invalid EFT format')
			return
		}

		const data = {
			fitting: eftString,
			category,
			maintainer,
			srpEligible,
			srpValue,
			fittingItems: [], // Server will parse and populate this
		}

		onSubmit(data)
	}

	const canSubmit =
		eftString.trim() !== '' && category.trim() !== '' && maintainer.trim() !== '' && !eftError

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			{/* EFT String */}
			<div className="space-y-2">
				<Label htmlFor="eft">EFT Fitting *</Label>
				<Textarea
					id="eft"
					value={eftString}
					onChange={(e) => handleEftChange(e.target.value)}
					onBlur={handleEftBlur}
					placeholder="Paste EFT format fitting here... Example:&#10;[Svipul, Cena Svipul]&#10;Counterbalanced Compact Gyrostabilizer&#10;280mm Howitzer Artillery II&#10;..."
					className="font-mono text-sm min-h-[200px]"
					required
				/>
				{eftError && <p className="text-sm text-destructive">{eftError}</p>}
				<p className="text-sm text-muted-foreground">
					Paste your EFT (EVE Fitting Tool) format fitting. A preview will appear below.
				</p>
			</div>

			{/* Preview */}
			{showPreview && eftString.trim() && (
				<div>
					<Label className="mb-2 block">Preview</Label>
					<EftPreview eftString={eftString} />
				</div>
			)}

			{/* Category */}
			<div className="space-y-2">
				<Label htmlFor="category">Category *</Label>
				<Input
					id="category"
					value={category}
					onChange={(e) => setCategory(e.target.value)}
					placeholder="e.g., Shield Fleets, Armor Fleets, Black Ops"
					required
				/>
				<p className="text-sm text-muted-foreground">
					Group this fitting under a category for organization
				</p>
			</div>

			{/* Maintainer */}
			<div className="space-y-2">
				<Label htmlFor="maintainer">Maintainer *</Label>
				<Input
					id="maintainer"
					value={maintainer}
					onChange={(e) => setMaintainer(e.target.value)}
					placeholder="Character name or group responsible"
					required
				/>
				<p className="text-sm text-muted-foreground">
					Who is responsible for maintaining this fitting?
				</p>
			</div>

			{/* SRP Eligible */}
			<div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
				<div className="flex-1 space-y-1">
					<Label htmlFor="srp-eligible">SRP Eligible</Label>
					<p className="text-sm text-muted-foreground">
						Mark this fitting as eligible for Ship Replacement Program
					</p>
				</div>
				<Switch id="srp-eligible" checked={srpEligible} onCheckedChange={setSrpEligible} />
			</div>

			{/* SRP Value (only if eligible) */}
			{srpEligible && (
				<div className="space-y-2">
					<Label htmlFor="srp-value">SRP Value (ISK)</Label>
					<Input
						id="srp-value"
						type="number"
						value={srpValue}
						onChange={(e) => setSrpValue(e.target.value)}
						placeholder="0"
						min="0"
						step="1000000"
					/>
					<p className="text-sm text-muted-foreground">
						The amount reimbursed if this ship is lost (in ISK)
					</p>
				</div>
			)}

			{/* Actions */}
			<div className="flex justify-end gap-2">
				<CancelButton onClick={onCancel} type="button">
					Cancel
				</CancelButton>
				<ConfirmButton
					type="submit"
					loading={isSubmitting}
					loadingText={fitting ? 'Updating...' : 'Creating...'}
					disabled={!canSubmit || isSubmitting}
				>
					{fitting ? 'Update Fitting' : 'Create Fitting'}
				</ConfirmButton>
			</div>
		</form>
	)
}
