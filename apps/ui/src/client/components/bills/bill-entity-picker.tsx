import { useMemo } from 'react'

import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useAppTranslation } from '@/i18n'

import type { EntitySearchType } from '@repo/bills'
import type { SelectOption } from '@/components/ui/select'
import type { AppTranslationKey } from '@/i18n'

const ENTITY_TYPE_LABELS: Record<EntitySearchType, AppTranslationKey> = {
	character: 'bills.entity.character',
	corporation: 'bills.entity.corporation',
	group: 'bills.entity.group',
	user: 'bills.picker.user',
}

type BillEntityPickerProps = {
	roleLabel: string
	typeFieldId: string
	entityFieldId: string
	entityType: EntitySearchType
	allowedEntityTypes: EntitySearchType[]
	onEntityTypeChange: (nextType: EntitySearchType) => void
	query: string
	onQueryChange: (query: string) => void
	options: SelectOption[]
	onEntitySelect: (entityId: string, name: string) => void
	loading: boolean
	selectedEntityId: string
	selectedEntityName?: string
	error?: string
	emptyText?: string
	staticOptions?: SelectOption[]
}

export function BillEntityPicker(props: BillEntityPickerProps) {
	const { t, locale } = useAppTranslation()
	const placeholderTypeLabel = useMemo(
		() =>
			ENTITY_TYPE_LABELS[props.entityType]
				? t(ENTITY_TYPE_LABELS[props.entityType])
				: props.entityType,
		[props.entityType, t]
	)
	const isStaticSelection = props.staticOptions !== undefined

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div className="space-y-2">
				<Label htmlFor={props.typeFieldId}>
					{t('bills.picker.type', { role: props.roleLabel })}{' '}
					<span className="text-destructive">*</span>
				</Label>
				<Select
					value={props.entityType}
					onValueChange={(value) => props.onEntityTypeChange(value as EntitySearchType)}
					inputId={props.typeFieldId}
					options={props.allowedEntityTypes.map((entityType) => ({
						value: entityType,
						label: t(ENTITY_TYPE_LABELS[entityType]),
					}))}
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor={props.entityFieldId}>
					{props.roleLabel} <span className="text-destructive">*</span>
				</Label>
				<Select
					inputId={props.entityFieldId}
					value={props.selectedEntityId}
					onValueChange={(nextValue, option) => {
						if (!option) {
							return
						}
						props.onEntitySelect(nextValue, option.label)
					}}
					query={isStaticSelection ? undefined : props.query}
					onQueryChange={isStaticSelection ? undefined : props.onQueryChange}
					searchable={!isStaticSelection}
					searchDelegate={isStaticSelection ? undefined : () => props.options}
					options={props.staticOptions ?? props.options}
					loading={isStaticSelection ? false : props.loading}
					placeholder={
						isStaticSelection
							? t('bills.picker.select', {
									type: locale === 'en' ? placeholderTypeLabel.toLowerCase() : placeholderTypeLabel,
								})
							: t('bills.picker.search', {
									type: locale === 'en' ? placeholderTypeLabel.toLowerCase() : placeholderTypeLabel,
								})
					}
					queryHintText={isStaticSelection ? undefined : t('bills.picker.hint')}
					minQueryLength={2}
					debounceMs={0}
					emptyText={
						props.emptyText ??
						t('bills.picker.empty', {
							role: locale === 'en' ? props.roleLabel.toLowerCase() : props.roleLabel,
						})
					}
					className={props.error ? 'border-destructive rounded-md' : ''}
				/>
				{props.error && <p className="text-sm text-destructive">{props.error}</p>}
				{props.selectedEntityId && (
					<p className="text-sm text-muted-foreground">
						{t('bills.picker.selected', { role: props.roleLabel })}{' '}
						{props.selectedEntityName ? (
							<>
								<span className="text-foreground">{props.selectedEntityName}</span>{' '}
								<span className="text-muted-foreground/70">
									{t('bills.picker.id', { id: props.selectedEntityId })}
								</span>
							</>
						) : (
							props.selectedEntityId
						)}
					</p>
				)}
			</div>
		</div>
	)
}
