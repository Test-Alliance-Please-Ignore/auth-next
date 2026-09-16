/**
 * Doctrine Form Component
 *
 * Form for creating or editing a doctrine
 */

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAppTranslation } from '@/i18n'
import { api } from '@/lib/api'
import { typeIconUrl } from '@/lib/eve-images'

import { useDoctrineCategories } from '../hooks'

import type { SelectOption } from '@/components/ui/select'
import type { CreateDoctrineRequest, Doctrine, UpdateDoctrineRequest } from '../types'

interface ShipOption extends SelectOption {
	value: string
	label: string
}

interface DoctrineFormProps {
	doctrine?: Doctrine
	onSubmit: (data: CreateDoctrineRequest | UpdateDoctrineRequest) => void | Promise<void>
	onCancel: () => void
	isSubmitting?: boolean
}

export function DoctrineForm({ doctrine, onSubmit, onCancel, isSubmitting }: DoctrineFormProps) {
	const { t } = useAppTranslation()

	const [name, setName] = useState(doctrine?.name || '')
	const [description, setDescription] = useState(doctrine?.description || '')
	const [sortOrder, setSortOrder] = useState(doctrine?.sortOrder ?? 0)
	const [shipTypeId, setShipTypeId] = useState(doctrine?.shipTypeId || '')
	const [categoryId, setCategoryId] = useState(doctrine?.categoryId || '')
	const { data: categories } = useDoctrineCategories()

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()

		const data: CreateDoctrineRequest = {
			name,
			description: description || undefined,
			shipTypeId: shipTypeId || undefined,
			categoryId: categoryId || undefined,
			sortOrder,
		}

		void onSubmit(data)
	}

	const searchShipTypes = async (query: string): Promise<ShipOption[]> => {
		const results = await api.searchShipTypes(query)
		return results.map((r) => ({ value: r.typeId, label: r.typeName }))
	}

	const canSubmit = name.trim() !== ''

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			{/* Name */}
			<div className="space-y-2">
				<Label htmlFor="name">{t('doctrines.doctrineName')}</Label>
				<Input
					id="name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder={t('doctrines.eGAlphaFleetBlopsDoctrineCaracalNavyIssue')}
					required
				/>
				<p className="text-sm text-muted-foreground">
					{t('doctrines.aDescriptiveNameForThisDoctrine')}
				</p>
			</div>

			{/* Description */}
			<div className="space-y-2">
				<Label htmlFor="description">{t('doctrines.description')}</Label>
				<Textarea
					id="description"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder={t('doctrines.describeThePurposeCompositionOrUsageOfThisDoctrine')}
					className="min-h-[100px]"
				/>
				<p className="text-sm text-muted-foreground">
					{t('doctrines.aShortDescriptionShownOnTheDoctrineCard')}
				</p>
			</div>

			{/* Category */}
			<div className="space-y-2">
				<Label>{t('doctrines.category')}</Label>
				<Select
					options={[
						{ value: '', label: t('doctrines.noCategory') },
						...(categories || []).map((c) => ({ value: c.id, label: c.name })),
					]}
					value={categoryId}
					onValueChange={(val) => setCategoryId(val)}
					placeholder={t('doctrines.selectACategory')}
				/>
				<p className="text-sm text-muted-foreground">
					{t('doctrines.groupThisDoctrineUnderACategory')}
				</p>
			</div>

			{/* Ship Icon */}
			<div className="space-y-2">
				<Label>{t('doctrines.shipIcon')}</Label>
				<div className="flex items-center gap-3">
					{shipTypeId && (
						<img
							src={typeIconUrl(shipTypeId, 64)}
							alt={t('doctrines.shipIcon2')}
							className="h-10 w-10 rounded"
						/>
					)}
					<div className="flex-1">
						<Select<ShipOption>
							options={[]}
							value={shipTypeId}
							onValueChange={(val) => setShipTypeId(val)}
							searchable
							searchDelegate={searchShipTypes}
							minQueryLength={2}
							debounceMs={300}
							placeholder={t('doctrines.searchForAShip')}
							emptyText={t('doctrines.noShips')}
							queryHintText={t('doctrines.searchTwo')}
							renderOption={(option) => (
								<div className="flex items-center gap-2">
									<img src={typeIconUrl(option.value, 32)} alt="" className="h-5 w-5 rounded" />
									<span>{option.label}</span>
								</div>
							)}
						/>
					</div>
				</div>
				<p className="text-sm text-muted-foreground">
					{t('doctrines.searchForAShipToUseAsTheDoctrineIcon')}
				</p>
			</div>

			{/* Sort Order */}
			<div className="space-y-2">
				<Label htmlFor="sortOrder">{t('doctrines.sortOrder')}</Label>
				<Input
					id="sortOrder"
					type="number"
					value={sortOrder}
					onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
					min="0"
					className="w-32"
				/>
				<p className="text-sm text-muted-foreground">
					{t('doctrines.lowerNumbersAppearFirstOnTheDoctrinesPage')}
				</p>
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
					loadingText={doctrine ? t('doctrines.updating') : t('doctrines.creating')}
					disabled={!canSubmit || isSubmitting}
				>
					{doctrine ? t('doctrines.updateDoctrine') : t('doctrines.createDoctrine')}
				</Button>
			</div>
		</form>
	)
}
