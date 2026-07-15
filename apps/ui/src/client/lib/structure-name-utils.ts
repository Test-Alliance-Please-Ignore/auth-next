function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function stripLeadingContextName(
	text: string | null | undefined,
	contextName: string | null | undefined
): string {
	const trimmedText = text?.trim()
	const trimmedContextName = contextName?.trim()

	if (!trimmedText) {
		return '-'
	}

	if (!trimmedContextName) {
		return trimmedText
	}

	const escapedContextName = escapeRegExp(trimmedContextName)
	const leadingPattern = new RegExp(
		`^${escapedContextName}(?:\\s*[-–—:|/]\\s*|\\s+)`,
		'i'
	)
	const stripped = trimmedText.replace(leadingPattern, '').trim()

	return stripped.length > 0 ? stripped : trimmedText
}
