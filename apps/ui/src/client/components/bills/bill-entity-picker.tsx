import { useMemo } from 'react'

import { Label } from '@/components/ui/label'
import { SearchSelect } from '@/components/ui/search-select'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'

import type { SearchSelectOption } from '@/components/ui/search-select'
import type { EntitySearchType } from '@repo/bills'

const ENTITY_TYPE_LABELS: Record<EntitySearchType, string> = {
	character: 'Character',
	corporation: 'Corporation',
	group: 'Group',
	user: 'User',
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
	options: SearchSelectOption[]
	onEntitySelect: (entityId: string, name: string) => void
	loading: boolean
	selectedEntityId: string
	selectedEntityName?: string
	error?: string
	emptyText?: string
}

export function BillEntityPicker(props: BillEntityPickerProps) {
	const placeholderTypeLabel = useMemo(
		() => ENTITY_TYPE_LABELS[props.entityType] ?? props.entityType,
		[props.entityType]
	)

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div className="space-y-2">
				<Label htmlFor={props.typeFieldId}>
					{props.roleLabel} Type <span className="text-destructive">*</span>
				</Label>
				<Select
					value={props.entityType}
					onValueChange={(value) => props.onEntityTypeChange(value as EntitySearchType)}
				>
					<SelectTrigger id={props.typeFieldId}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{props.allowedEntityTypes.map((entityType) => (
							<SelectItem key={entityType} value={entityType}>
								{ENTITY_TYPE_LABELS[entityType]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-2">
				<Label htmlFor={props.entityFieldId}>
					{props.roleLabel} <span className="text-destructive">*</span>
				</Label>
				<SearchSelect
					inputId={props.entityFieldId}
					value={props.query}
					onValueChange={props.onQueryChange}
					options={props.options}
					onSelect={(option) => props.onEntitySelect(option.value, option.label)}
					loading={props.loading}
					placeholder={`Search ${placeholderTypeLabel.toLowerCase()} name or ID`}
					minCharsText="Type at least 2 characters to search"
					emptyText={props.emptyText ?? `No ${props.roleLabel.toLowerCase()} matches`}
					className={props.error ? 'border-destructive rounded-md' : ''}
				/>
				{props.error && <p className="text-sm text-destructive">{props.error}</p>}
				{props.selectedEntityId && (
					<p className="text-sm text-muted-foreground">
						Selected {props.roleLabel}:{' '}
						{props.selectedEntityName ? (
							<>
								<span className="text-foreground">{props.selectedEntityName}</span>{' '}
								<span className="text-muted-foreground/70">(ID: {props.selectedEntityId})</span>
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
