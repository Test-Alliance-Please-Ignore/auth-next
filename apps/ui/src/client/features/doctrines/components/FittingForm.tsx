/**
 * Fitting Form Component
 *
 * Form for creating or editing a fitting with EFT textarea and preview
 */

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { useDoctrineCategories } from '../hooks'
import { validateEFT } from '../utils'
import { EftPreview } from './EftPreview'

import type { CreateFittingRequest, Fitting, UpdateFittingRequest } from '../types'

interface FittingFormProps {
	fitting?: Fitting
	onSubmit: (data: CreateFittingRequest | UpdateFittingRequest) => void | Promise<void>
	onCancel: () => void
	isSubmitting?: boolean
	onPreviewChange?: (eftString: string | null) => void
}

export function FittingForm({ fitting, onSubmit, onCancel, isSubmitting, onPreviewChange }: FittingFormProps) {
	const [eftString, setEftString] = useState(fitting?.fitting || '')
	const [description, setDescription] = useState(fitting?.description || '')
	const [category, setCategory] = useState(fitting?.category || '')
	const [srpEligible, setSrpEligible] = useState(fitting?.srpEligible || false)
	const [srpValue, setSrpValue] = useState(fitting?.srpValue || '0')
	const [showPreview, setShowPreview] = useState(false)
	const [eftError, setEftError] = useState<string | null>(null)
	const { data: categories } = useDoctrineCategories()

	const handleEftChange = (value: string) => {
		setEftString(value)
		setEftError(null)
		setShowPreview(false)
		onPreviewChange?.(null)
	}

	const handleEftBlur = () => {
		if (eftString.trim()) {
			const validation = validateEFT(eftString)
			if (validation.valid) {
				setShowPreview(true)
				onPreviewChange?.(eftString)
			} else {
				setEftError(validation.error || 'Invalid EFT format')
				onPreviewChange?.(null)
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
			description: description || undefined,
			category,
			srpEligible,
			srpValue,
			fittingItems: [], // Server will parse and populate this
		}

		onSubmit(data)
	}

	const canSubmit =
		eftString.trim() !== '' && category.trim() !== '' && !eftError

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

			{/* Inline Preview (only when no external handler) */}
			{!onPreviewChange && showPreview && eftString.trim() && (
				<div>
					<Label className="mb-2 block">Preview</Label>
					<EftPreview eftString={eftString} />
				</div>
			)}

			{/* Category */}
			<div className="space-y-2">
				<Label>Category *</Label>
				<Select
					options={(categories || []).map((c) => ({ value: c.name, label: c.name }))}
					value={category}
					onValueChange={(val) => setCategory(val)}
					placeholder="Select a category..."
				/>
				<p className="text-sm text-muted-foreground">
					Group this fitting under a category for organization
				</p>
			</div>

			{/* Description */}
			<div className="space-y-2">
				<Label htmlFor="description">Description</Label>
				<Textarea
					id="description"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="Describe the fitting's purpose, usage notes, etc."
					className="min-h-[80px]"
				/>
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

			{/* Actions */}
			<div className="flex justify-end gap-2">
				<Button variant="cancel" onClick={onCancel} type="button">
					Cancel
				</Button>
				<Button variant="confirm"
					type="submit"
					loading={isSubmitting}
					loadingText={fitting ? 'Updating...' : 'Creating...'}
					disabled={!canSubmit || isSubmitting}
				>
					{fitting ? 'Update Fitting' : 'Create Fitting'}
				</Button>
			</div>
		</form>
	)
}
