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

	private async request<T>(
		endpoint: string,
		options?: RequestInit
	): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`

		// Get session token from localStorage
		const sessionToken = typeof window !== 'undefined' ? localStorage.getItem('sessionToken') : null

		const response = await fetch(url, {
			...options,
			headers: {
				'Content-Type': 'application/json',
				...(sessionToken && { 'Authorization': `Bearer ${sessionToken}` }),
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
}

export const apiClient = new ApiClient()
