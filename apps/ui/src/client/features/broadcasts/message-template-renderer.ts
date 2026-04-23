import { parseBroadcastSrpMode, renderBroadcastSrpSection } from '@repo/broadcasts'

export function renderBroadcastTemplateMessage(
	template: string,
	fields: Record<string, string | undefined>,
	includeEmptyMissing = false
): string {
	return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawToken: string) => {
		const token = String(rawToken ?? '').trim()
		const wrappedToken =
			token.startsWith('<') && token.endsWith('>') ? token.slice(1, -1).trim() : token
		let key = wrappedToken
		if (wrappedToken.startsWith('select:')) {
			const selectBody = wrappedToken.slice('select:'.length)
			const separator = selectBody.indexOf(':')
			if (separator > 0) {
				const labelName = selectBody.slice(0, separator).trim()
				key = `select:${labelName}`
			}
		}

		if (key === 'srp') {
			const mode = parseBroadcastSrpMode(fields.srp)
			return renderBroadcastSrpSection(mode, fields.__srpToken ?? '')
		}

		const value = fields[key]
		if (typeof value === 'string') return value
		if (wrappedToken === 'doctrine' || wrappedToken === 'staging' || wrappedToken === 'srp') {
			return includeEmptyMissing ? '' : `{{<${wrappedToken}>}}`
		}
		if (wrappedToken.startsWith('select:')) {
			return includeEmptyMissing ? '' : `{{<${key || wrappedToken}>}}`
		}
		return includeEmptyMissing ? '' : `{{${key || token}}}`
	})
}

