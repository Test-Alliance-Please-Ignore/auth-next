import { useEffect, useMemo, useState } from 'react'

import { Select } from '@/components/ui/select'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

interface TaxCorporationScopeSelectorProps {
	corporations: Array<{
		corporationId: string
		name: string
	}>
	effectiveCorporationId?: string
	selectedCorporationId?: string
	canSelectAll?: boolean
	allLabel?: string
	showLabel?: boolean
	className?: string
	onSelect: (corporationId: string | undefined) => void
}

export function TaxCorporationScopeSelector({
	corporations,
	effectiveCorporationId,
	selectedCorporationId,
	canSelectAll = false,
	allLabel,
	showLabel = true,
	className,
	onSelect,
}: TaxCorporationScopeSelectorProps) {
	const { t } = useAppTranslation()

	const options = useMemo(() => {
		const baseOptions = [...corporations]
			.sort((left, right) =>
				left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
			)
			.map((corp) => ({
				value: corp.corporationId,
				label: corp.name,
			}))

		if (!canSelectAll) {
			return baseOptions
		}

		return [
			{
				value: '__all__',
				label: allLabel ?? t('tax.allCorporations'),
			},
			...baseOptions,
		]
	}, [allLabel, canSelectAll, corporations, t])

	const selectedId = selectedCorporationId ?? (canSelectAll ? '__all__' : effectiveCorporationId)
	const selectedOption = options.find((option) => option.value === selectedId)
	const [query, setQuery] = useState('')

	useEffect(() => {
		setQuery('')
	}, [selectedId])

	if (options.length === 0) {
		return null
	}

	return (
		<div className={cn('flex flex-col gap-2 sm:max-w-md', className)}>
			{showLabel ? (
				<div className="text-sm font-medium text-foreground">{t('tax.corporationScope')}</div>
			) : null}
			<Select
				value={selectedId}
				onValueChange={(nextValue) => {
					setQuery('')
					onSelect(nextValue === '__all__' ? undefined : nextValue)
				}}
				query={query}
				onQueryChange={setQuery}
				searchable
				options={options}
				placeholder={selectedOption?.label ?? t('tax.selectCorporationScope')}
				emptyText={t('tax.noCorporationsMatch')}
			/>
		</div>
	)
}
