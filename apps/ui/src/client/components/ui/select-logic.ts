export interface SelectOptionLike {
	value: string
	label: string
	description?: string
	descriptionClassName?: string
}

export interface SelectAllOptionLike {
	value: string
	label: string
	description?: string
	descriptionClassName?: string
}

export interface SelectSearchFlagsInput {
	searchable: boolean
	searchDelegate: unknown
	trimmedQuery: string
	minQueryLength: number
}

export interface SelectSearchFlags {
	hasSearchDelegate: boolean
	queryMeetsMinimum: boolean
	queryTooShort: boolean
}

export function resolveSelectSearchFlags({
	searchable,
	searchDelegate,
	trimmedQuery,
	minQueryLength,
}: SelectSearchFlagsInput): SelectSearchFlags {
	const hasSearchDelegate = searchable && typeof searchDelegate === 'function'
	const queryMeetsMinimum = trimmedQuery.length >= minQueryLength
	const queryTooShort =
		searchable && hasSearchDelegate && trimmedQuery.length > 0 && !queryMeetsMinimum

	return {
		hasSearchDelegate,
		queryMeetsMinimum,
		queryTooShort,
	}
}

export function resolveBaseOptions<TOption extends SelectOptionLike>({
	hasSearchDelegate,
	options,
	isCommitted,
	trimmedQuery,
	queryMeetsMinimum,
	delegateOptions,
}: {
	hasSearchDelegate: boolean
	options: TOption[]
	isCommitted: boolean
	trimmedQuery: string
	queryMeetsMinimum: boolean
	delegateOptions: TOption[]
}): TOption[] {
	if (!hasSearchDelegate) {
		return options
	}

	if (isCommitted || trimmedQuery.length === 0) {
		return [] as TOption[]
	}

	if (!queryMeetsMinimum) {
		return [] as TOption[]
	}

	return delegateOptions
}

export function filterSelectOptions<TOption extends SelectOptionLike>({
	searchable,
	hasSearchDelegate,
	baseOptions,
	trimmedQuery,
	getOptionSearchText,
}: {
	searchable: boolean
	hasSearchDelegate: boolean
	baseOptions: TOption[]
	trimmedQuery: string
	getOptionSearchText?: (option: TOption) => string
}): TOption[] {
	if (!searchable) {
		return baseOptions
	}

	if (hasSearchDelegate) {
		return baseOptions
	}

	if (!trimmedQuery) {
		return baseOptions
	}

	const normalizedQuery = trimmedQuery.toLowerCase()
	return baseOptions.filter((option) => {
		const defaultSearchText = `${option.label} ${option.value} ${option.description ?? ''}`
		const searchText = getOptionSearchText ? getOptionSearchText(option) : defaultSearchText
		return searchText.toLowerCase().includes(normalizedQuery)
	})
}

type SelectAllInternalOption = SelectOptionLike & { __selectAll: true }
export type InternalSelectOption<TOption extends SelectOptionLike> =
	| TOption
	| SelectAllInternalOption

export function isSelectAllInternalOption<TOption extends SelectOptionLike>(
	option: InternalSelectOption<TOption>
): option is SelectAllInternalOption {
	return '__selectAll' in option && option.__selectAll === true
}

export function buildRenderedSelectOptions<TOption extends SelectOptionLike>({
	filteredOptions,
	selectAllOption,
}: {
	filteredOptions: TOption[]
	selectAllOption?: SelectAllOptionLike
}): Array<InternalSelectOption<TOption>> {
	if (!selectAllOption) {
		return filteredOptions
	}

	return [
		{
			value: selectAllOption.value,
			label: selectAllOption.label,
			description: selectAllOption.description,
			descriptionClassName: selectAllOption.descriptionClassName,
			__selectAll: true,
		},
		...filteredOptions,
	]
}

export function buildKnownSelectOptions<TOption extends SelectOptionLike>({
	options,
	delegateOptions,
	filteredOptions,
}: {
	options: TOption[]
	delegateOptions: TOption[]
	filteredOptions: TOption[]
}): TOption[] {
	const optionByValue = new Map<string, TOption>()
	for (const option of options) {
		optionByValue.set(option.value, option)
	}
	for (const option of delegateOptions) {
		optionByValue.set(option.value, option)
	}
	for (const option of filteredOptions) {
		optionByValue.set(option.value, option)
	}
	return [...optionByValue.values()]
}

export function resolveSelectedOption<TOption extends SelectOptionLike>({
	knownOptions,
	selectedValue,
}: {
	knownOptions: TOption[]
	selectedValue: string
}): TOption | null {
	if (!selectedValue) {
		return null
	}

	const valueMatch = knownOptions.find((option) => option.value === selectedValue)
	if (valueMatch) {
		return valueMatch
	}

	const labelMatches = knownOptions.filter((option) => option.label === selectedValue)
	if (labelMatches.length === 1) {
		return labelMatches[0] ?? null
	}

	return null
}

export function resolveSelectedLabel({
	selectedValue,
	selectedOptionLabel,
	cachedSelectedLabel,
}: {
	selectedValue: string
	selectedOptionLabel: string | null
	cachedSelectedLabel: string | null
}): string | null {
	if (!selectedValue) {
		return null
	}

	return selectedOptionLabel ?? cachedSelectedLabel ?? null
}

export function resolveCanShowSelectOptions({
	minQueryBlocked,
	renderedOptionsLength,
}: {
	minQueryBlocked: boolean
	renderedOptionsLength: number
}): boolean {
	return !minQueryBlocked && renderedOptionsLength > 0
}

export function resolveShouldOpenSelectOnFocus({
	searchable,
	isCommitted,
	trimmedQuery,
	renderedOptionsLength,
}: {
	searchable: boolean
	isCommitted: boolean
	trimmedQuery: string
	renderedOptionsLength: number
}): boolean {
	return !searchable || (!isCommitted && trimmedQuery.length > 0) || renderedOptionsLength > 0
}

export function resolveSelectInputPlaceholder({
	searchable,
	effectiveQueryValue,
	selectedLabel,
	placeholder,
}: {
	searchable: boolean
	effectiveQueryValue: string
	selectedLabel: string | null
	placeholder: string
}): string {
	if (searchable && effectiveQueryValue.length === 0 && selectedLabel !== null) {
		return selectedLabel
	}

	return placeholder
}
