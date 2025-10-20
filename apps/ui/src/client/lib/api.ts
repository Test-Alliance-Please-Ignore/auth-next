/**
 * API client for making requests to the core worker
 */

const API_BASE_URL = import.meta.env.PROD ? '/api' : 'http://localhost:8787/api'

export interface ApiError {
	message: string
	status: number
}

export class ApiClient {
	private baseUrl: string

	constructor(baseUrl: string = API_BASE_URL) {
		this.baseUrl = baseUrl
	}

	private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`

		// Get session token from localStorage
		const sessionToken = typeof window !== 'undefined' ? localStorage.getItem('sessionToken') : null

		const response = await fetch(url, {
			...options,
			headers: {
				'Content-Type': 'application/json',
				...(sessionToken && { Authorization: `Bearer ${sessionToken}` }),
				...options?.headers,
			},
			credentials: 'include', // Include cookies for session management
		})

		if (!response.ok) {
			const error: ApiError = {
				message: `API request failed: ${response.statusText}`,
				status: response.status,
			}
			throw error
		}

		return response.json()
	}

	async get<T>(endpoint: string): Promise<T> {
		return this.request<T>(endpoint, { method: 'GET' })
	}

	async post<T>(endpoint: string, data?: unknown): Promise<T> {
		return this.request<T>(endpoint, {
			method: 'POST',
			body: JSON.stringify(data),
		})
	}

	async put<T>(endpoint: string, data?: unknown): Promise<T> {
		return this.request<T>(endpoint, {
			method: 'PUT',
			body: JSON.stringify(data),
		})
	}

	async delete<T>(endpoint: string): Promise<T> {
		return this.request<T>(endpoint, { method: 'DELETE' })
	}

	async getCharacterDetail(characterId: number): Promise<{
		characterId: number
		isOwner: boolean
		public: {
			info: any
			portrait: any
			corporationHistory: any[]
			skills: any
			attributes: any
		}
		private?: {
			location?: any
			wallet?: any
			assets?: any
			status?: any
			skillQueue?: any[]
		}
		lastUpdated: string | null
	}> {
		return this.get(`/characters/${characterId}`)
	}

	async refreshCharacterById(characterId: number): Promise<{
		success: boolean
		message: string
		lastUpdated: string | null
		hasValidToken: boolean
	}> {
		return this.post(`/characters/${characterId}/refresh`)
	}

	async getSkillMetadata(skillIds: string): Promise<any[]> {
		// Call through core API which proxies to eve-static-data service
		return this.get(`/skills?ids=${skillIds}`)
	}

	async startDiscordLinking(): Promise<{ url: string }> {
		return this.post('/discord/link/start')
	}
}

export const apiClient = new ApiClient()

// Export convenience methods
export const api = {
	getCharacterDetail: (characterId: number) => apiClient.getCharacterDetail(characterId),
	refreshCharacterById: (characterId: number) => apiClient.refreshCharacterById(characterId),
	getSkillMetadata: (skillIds: string) => apiClient.getSkillMetadata(skillIds),
}
