export interface ParseJsonResponseOptions {
	context?: string
	allowEmpty?: boolean
}

export async function parseJsonResponse<T>(
	response: Response,
	options: ParseJsonResponseOptions = {}
): Promise<T> {
	const { context = 'response', allowEmpty = false } = options
	const text = await response.text()

	if (!text.trim()) {
		if (allowEmpty || response.status === 204) {
			return null as T
		}
		throw new Error(`${context} returned an empty body`)
	}

	try {
		return JSON.parse(text) as T
	} catch (error) {
		const contentType = response.headers.get('content-type') ?? 'unknown'
		const snippet = text.slice(0, 240)
		const detail = error instanceof Error ? error.message : String(error)
		throw new Error(
			`${context} returned invalid JSON (status=${response.status}, contentType=${contentType}): ${detail}. Body: ${snippet}`
		)
	}
}
