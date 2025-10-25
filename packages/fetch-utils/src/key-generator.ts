import { blake3_hash } from '@earthbucks/blake3'

/**
 * Hash a string using BLAKE3
 * Returns a hex string representation of the hash
 */
function hashString(value: string): string {
	const encoder = new TextEncoder()
	const data = encoder.encode(value)
	const hash = blake3_hash(data)
	// Convert Uint8Array to hex string
	return Array.from(hash)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * Extract Authorization header from request
 */
function getAuthHeader(input: RequestInfo | URL, init?: RequestInit): string | null {
	// Check init headers first
	if (init?.headers) {
		if (init.headers instanceof Headers) {
			return init.headers.get('Authorization')
		}
		if (Array.isArray(init.headers)) {
			const authEntry = init.headers.find(([key]) => key.toLowerCase() === 'authorization')
			return authEntry ? authEntry[1] : null
		}
		if (typeof init.headers === 'object') {
			const headers = init.headers as Record<string, string>
			return headers['Authorization'] || headers['authorization'] || null
		}
	}

	// Check Request object headers
	if (input instanceof Request) {
		return input.headers.get('Authorization')
	}

	return null
}

/**
 * Default key generator that creates cache keys based on HTTP method and URL
 *
 * IMPORTANT: This generator does NOT consider Authorization headers.
 * Use defaultAuthAwareKeyGenerator() for authenticated requests to prevent
 * data leakage between users.
 *
 * @param input - Request URL or Request object
 * @param init - RequestInit options
 * @returns Cache key string in format: "METHOD:URL"
 *
 * @example
 * defaultKeyGenerator('https://api.example.com/users', { method: 'GET' })
 * // Returns: "GET:https://api.example.com/users"
 */
export function defaultKeyGenerator(input: RequestInfo | URL, init?: RequestInit): string {
	const url =
		typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
	const method = init?.method?.toUpperCase() || 'GET'
	return `${method}:${url}`
}

/**
 * Auth-aware key generator that includes hashed Authorization header
 *
 * This is the RECOMMENDED default for most use cases. It prevents data leakage
 * between users by including a hash of the Authorization header in the cache key.
 *
 * Security: The Authorization header is hashed using BLAKE3 before being included
 * in the cache key to avoid storing sensitive credentials in memory.
 *
 * @param input - Request URL or Request object
 * @param init - RequestInit options
 * @returns Cache key in format: "METHOD:URL" or "METHOD:URL:AUTH_HASH"
 *
 * @example
 * defaultAuthAwareKeyGenerator('https://api.example.com/profile', {
 *   method: 'GET',
 *   headers: { Authorization: 'Bearer token123' }
 * })
 * // Returns: "GET:https://api.example.com/profile:a1b2c3d4..."
 */
export function defaultAuthAwareKeyGenerator(input: RequestInfo | URL, init?: RequestInit): string {
	const baseKey = defaultKeyGenerator(input, init)
	const authHeader = getAuthHeader(input, init)

	if (authHeader) {
		const authHash = hashString(authHeader)
		return `${baseKey}:${authHash}`
	}

	return baseKey
}

/**
 * Body-aware key generator that includes request body in the cache key
 *
 * IMPORTANT: This generator does NOT consider Authorization headers.
 * Use bodyAndAuthAwareKeyGenerator() for authenticated requests to prevent
 * data leakage between users.
 *
 * This is useful for POST/PUT/PATCH requests where the same URL with different
 * bodies should be treated as different requests.
 *
 * @param input - Request URL or Request object
 * @param init - RequestInit options
 * @returns Cache key string in format: "METHOD:URL" or "METHOD:URL:BODY"
 *
 * @example
 * bodyAwareKeyGenerator('https://api.example.com/search', {
 *   method: 'POST',
 *   body: JSON.stringify({ query: 'test' })
 * })
 * // Returns: "POST:https://api.example.com/search:{"query":"test"}"
 */
export function bodyAwareKeyGenerator(input: RequestInfo | URL, init?: RequestInit): string {
	const baseKey = defaultKeyGenerator(input, init)
	const method = init?.method?.toUpperCase() || 'GET'

	// Only include body for methods that typically have request bodies
	if (['POST', 'PUT', 'PATCH'].includes(method) && init?.body) {
		let bodyStr: string

		if (typeof init.body === 'string') {
			bodyStr = init.body
		} else if (init.body instanceof URLSearchParams) {
			bodyStr = init.body.toString()
		} else if (init.body instanceof FormData) {
			// FormData is more complex, just use a placeholder
			bodyStr = '[FormData]'
		} else if (init.body instanceof ReadableStream) {
			// Cannot read stream without consuming it
			bodyStr = '[ReadableStream]'
		} else if (init.body instanceof Blob) {
			// Cannot read blob synchronously
			bodyStr = '[Blob]'
		} else if (ArrayBuffer.isView(init.body) || init.body instanceof ArrayBuffer) {
			// Binary data
			bodyStr = '[Binary]'
		} else {
			// Try to stringify as JSON
			try {
				bodyStr = JSON.stringify(init.body)
			} catch {
				bodyStr = '[Unknown]'
			}
		}

		return `${baseKey}:${bodyStr}`
	}

	return baseKey
}

/**
 * Combined key generator that includes both Authorization header and request body
 *
 * This is the RECOMMENDED generator for authenticated POST/PUT/PATCH requests.
 * It prevents data leakage by hashing the Authorization header and includes the
 * request body to differentiate requests with different payloads.
 *
 * @param input - Request URL or Request object
 * @param init - RequestInit options
 * @returns Cache key with auth hash and body
 *
 * @example
 * bodyAndAuthAwareKeyGenerator('https://api.example.com/search', {
 *   method: 'POST',
 *   headers: { Authorization: 'Bearer token123' },
 *   body: JSON.stringify({ query: 'test' })
 * })
 * // Returns: "POST:https://api.example.com/search:a1b2c3d4...:{"query":"test"}"
 */
export function bodyAndAuthAwareKeyGenerator(input: RequestInfo | URL, init?: RequestInit): string {
	const baseKey = defaultKeyGenerator(input, init)
	const authHeader = getAuthHeader(input, init)
	const method = init?.method?.toUpperCase() || 'GET'

	const parts: string[] = [baseKey]

	// Add auth hash if present
	if (authHeader) {
		const authHash = hashString(authHeader)
		parts.push(authHash)
	}

	// Add body for POST/PUT/PATCH
	if (['POST', 'PUT', 'PATCH'].includes(method) && init?.body) {
		let bodyStr: string

		if (typeof init.body === 'string') {
			bodyStr = init.body
		} else if (init.body instanceof URLSearchParams) {
			bodyStr = init.body.toString()
		} else if (init.body instanceof FormData) {
			bodyStr = '[FormData]'
		} else if (init.body instanceof ReadableStream) {
			bodyStr = '[ReadableStream]'
		} else if (init.body instanceof Blob) {
			bodyStr = '[Blob]'
		} else if (ArrayBuffer.isView(init.body) || init.body instanceof ArrayBuffer) {
			bodyStr = '[Binary]'
		} else {
			try {
				bodyStr = JSON.stringify(init.body)
			} catch {
				bodyStr = '[Unknown]'
			}
		}

		parts.push(bodyStr)
	}

	return parts.join(':')
}
