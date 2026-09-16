/**
 * Fitting Form Component
 *
 * Form for creating or editing a fitting with EFT textarea and preview
 */

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAppTranslation } from '@/i18n'

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

export function FittingForm({
	fitting,
	onSubmit,
	onCancel,
	isSubmitting,
	onPreviewChange,
}: FittingFormProps) {
	const { t } = useAppTranslation()

	const [eftString, setEftString] = useState(fitting?.fitting || '')
	const [description, setDescription] = useState(fitting?.description || '')
	const [category, setCategory] = useState(fitting?.category || '')
	const [srpEligible, setSrpEligible] = useState(fitting?.srpEligible || false)
	const [srpValue] = useState(fitting?.srpValue || '0')
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
				setEftError(validation.error || t('doctrines.invalidEftFormat2'))
				onPreviewChange?.(null)
			}
		}
	}

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()

		// Validate EFT before submitting
		const validation = validateEFT(eftString)
		if (!validation.valid) {
			setEftError(validation.error || t('doctrines.invalidEftFormat2'))
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

		void onSubmit(data)
	}

	const canSubmit = eftString.trim() !== '' && category.trim() !== '' && !eftError

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			{/* EFT String */}
			<div className="space-y-2">
				<Label htmlFor="eft">{t('doctrines.eftFitting')}</Label>
				<Textarea
					id="eft"
					value={eftString}
					onChange={(e) => handleEftChange(e.target.value)}
					onBlur={handleEftBlur}
					placeholder={t(
						'doctrines.pasteEftFormatFittingHereExampleSvipulCenaSvipulCounterbalanced'
					)}
					className="font-mono text-sm min-h-[200px]"
					required
				/>
				{eftError && <p className="text-sm text-destructive">{eftError}</p>}
				<p className="text-sm text-muted-foreground">
					{t('doctrines.pasteYourEftEveFittingToolFormatFittingAPreview')}
				</p>
			</div>

			{/* Inline Preview (only when no external handler) */}
			{!onPreviewChange && showPreview && eftString.trim() && (
				<div>
					<Label className="mb-2 block">{t('doctrines.preview')}</Label>
					<EftPreview eftString={eftString} />
				</div>
			)}

			{/* Category */}
			<div className="space-y-2">
				<Label>{t('doctrines.category2')}</Label>
				<Select
					options={(categories || []).map((c) => ({ value: c.name, label: c.name }))}
					value={category}
					onValueChange={(val) => setCategory(val)}
					placeholder={t('doctrines.selectACategory')}
				/>
				<p className="text-sm text-muted-foreground">
					{t('doctrines.groupThisFittingUnderACategoryForOrganization')}
				</p>
			</div>

			{/* Description */}
			<div className="space-y-2">
				<Label htmlFor="description">{t('doctrines.description')}</Label>
				<Textarea
					id="description"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder={t('doctrines.describeTheFittingSPurposeUsageNotesEtc')}
					className="min-h-[80px]"
				/>
			</div>

			{/* SRP Eligible */}
			<div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
				<div className="flex-1 space-y-1">
					<Label htmlFor="srp-eligible">{t('doctrines.srpEligible')}</Label>
					<p className="text-sm text-muted-foreground">
						{t('doctrines.markThisFittingAsEligibleForShipReplacementProgram')}
					</p>
				</div>
				<Switch id="srp-eligible" checked={srpEligible} onCheckedChange={setSrpEligible} />
			</div>

			{/* Actions */}
			<div className="flex justify-end gap-2">
				<Button variant="cancel" onClick={onCancel} type="button">
					{t('doctrines.cancel')}
				</Button>
				<Button
					variant="confirm"
					type="submit"
					loading={isSubmitting}
					loadingText={fitting ? t('doctrines.updating') : t('doctrines.creating')}
					disabled={!canSubmit || isSubmitting}
				>
					{fitting ? t('doctrines.updateFitting') : t('doctrines.createFitting')}
				</Button>
			</div>
		</form>
	)
}
