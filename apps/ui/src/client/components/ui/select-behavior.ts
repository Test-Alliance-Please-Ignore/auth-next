interface ResolveInputValueParams {
	searchable: boolean
	queryValue: string
	selectedOptionLabel: string | null
	open: boolean
	focused: boolean
}

interface ShouldClearQueryOnSelectParams {
	searchable: boolean
	queryValue: string
}

export function resolveSelectInputValue({
	searchable,
	queryValue,
	selectedOptionLabel,
	open,
	focused,
}: ResolveInputValueParams): string {
	if (!searchable) {
		return selectedOptionLabel ?? ''
	}

	if (queryValue.length === 0 && selectedOptionLabel !== null && !open && !focused) {
		return selectedOptionLabel
	}

	return queryValue
}

export function shouldClearSelectQueryOnSelect({
	searchable,
	queryValue,
}: ShouldClearQueryOnSelectParams): boolean {
	return searchable && queryValue.trim().length > 0
}
