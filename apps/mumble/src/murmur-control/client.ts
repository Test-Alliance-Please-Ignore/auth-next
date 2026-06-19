import {
	BatchAssignLocalAccountGroupsResponseSchema,
	BatchDeleteLocalAccountsResponseSchema,
	BatchDisableLocalAccountsResponseSchema,
	BatchEnableLocalAccountsResponseSchema,
	BatchSyncLocalAccountsResponseSchema,
	LocalAccountResponseSchema,
	MurmurControlErrorResponseSchema,
	UserProjectionStateResponseSchema,
} from '@repo/mumble'

import type { ZodType } from 'zod'
import type {
	BatchAssignLocalAccountGroupsResponse,
	BatchDeleteLocalAccountsResponse,
	BatchDisableLocalAccountsResponse,
	BatchEnableLocalAccountsResponse,
	BatchSyncLocalAccountsResponse,
	LocalAccountGroupAssignment,
	LocalAccountSnapshot,
	SyncedLocalAccount,
	UserProjectionStateResponse,
} from '@repo/mumble'

export interface MurmurControlFetcher {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export type MurmurControlErrorCode =
	| 'unauthorized'
	| 'validation'
	| 'not_found'
	| 'unavailable'
	| 'unknown'

/**
 * Typed error for murmur-control API failures.
 */
export class MurmurControlApiError extends Error {
	readonly status: number
	readonly code: MurmurControlErrorCode
	readonly details: unknown

	constructor(status: number, message: string, details?: unknown) {
		super(message)
		this.name = 'MurmurControlApiError'
		this.status = status
		this.code = MurmurControlApiError.codeForStatus(status)
		this.details = details
	}

	private static codeForStatus(status: number): MurmurControlErrorCode {
		if (status === 401) return 'unauthorized'
		if (status === 400) return 'validation'
		if (status === 404) return 'not_found'
		if (status === 501 || status >= 500) return 'unavailable'
		return 'unknown'
	}
}

export interface MurmurControlClientOptions {
	baseUrl: string
	fetcher?: MurmurControlFetcher | null
	token?: string | null
	environment?: string | null
}

/**
 * Minimal typed client for the murmur-control REST API.
 * Covers the local-account and user-state surfaces used by the MVP.
 */
export class MurmurControlClient {
	private readonly baseUrl: string
	private readonly fetcher?: MurmurControlFetcher | null
	private readonly token?: string | null
	private readonly environment?: string | null

	constructor(options: MurmurControlClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, '')
		this.fetcher = options.fetcher
		this.token = options.token
		this.environment = options.environment
	}

	private isDevLike(): boolean {
		const environment = this.environment?.trim().toLowerCase()
		if (!environment) return false
		return ['dev', 'development', 'local', 'test', 'vitest'].includes(environment)
	}

	private validateTransport(): void {
		if (this.isDevLike()) return

		if (!this.baseUrl.startsWith('https://')) {
			throw new Error('murmur-control requires an HTTPS base URL in production-like environments')
		}

		const hasMtls = this.fetcher != null
		const hasToken = (this.token?.trim().length ?? 0) > 0
		if (!hasMtls && !hasToken) {
			throw new Error('murmur-control requires mTLS or a bearer token in production-like environments')
		}
	}

	private async request<T>(
		method: string,
		path: string,
		schema: ZodType<T>,
		body?: unknown
	): Promise<T> {
		this.validateTransport()

		const headers: Record<string, string> = {}
		const token = this.token?.trim()
		if (token !== undefined && token.length > 0) {
			headers.Authorization = `Bearer ${token}`
		}
		if (body !== undefined) {
			headers['Content-Type'] = 'application/json'
		}

		const requestInit: RequestInit = {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
		}
		const response = this.fetcher
			? await this.fetcher.fetch(`${this.baseUrl}${path}`, requestInit)
			: await fetch(`${this.baseUrl}${path}`, requestInit)

		if (!response.ok) {
			let message = `murmur-control request failed: ${response.status}`
			let details: unknown
			try {
				const parsed = MurmurControlErrorResponseSchema.safeParse(await response.json())
				if (parsed.success) {
					message = parsed.data.error
					details = parsed.data.details
				}
			} catch {
				// Non-JSON error body; keep the status-based message
			}
			throw new MurmurControlApiError(response.status, message, details)
		}

		return schema.parse(await response.json())
	}

	/** Get a local account snapshot, or null when it does not exist. */
	async getLocalAccount(serverId: string, subjectId: string): Promise<LocalAccountSnapshot | null> {
		try {
			const result = await this.request(
				'GET',
				`/v1/servers/${encodeURIComponent(serverId)}/local-accounts/${encodeURIComponent(subjectId)}`,
				LocalAccountResponseSchema
			)
			return result.account
		} catch (error) {
			if (error instanceof MurmurControlApiError && error.code === 'not_found') {
				return null
			}
			throw error
		}
	}

	/** List projected user state, optionally filtered (at most one filter). */
	async getUserState(
		serverId: string,
		filter?: { subjectId?: string; loginName?: string; murmurUserId?: number }
	): Promise<UserProjectionStateResponse> {
		const params = new URLSearchParams()
		if (filter?.subjectId !== undefined) params.set('subjectId', filter.subjectId)
		if (filter?.loginName !== undefined) params.set('loginName', filter.loginName)
		if (filter?.murmurUserId !== undefined) params.set('murmurUserId', String(filter.murmurUserId))
		const query = params.size > 0 ? `?${params.toString()}` : ''
		return this.request(
			'GET',
			`/v1/servers/${encodeURIComponent(serverId)}/state/users${query}`,
			UserProjectionStateResponseSchema
		)
	}

	/** Create or update the listed accounts (omitted accounts untouched). */
	async batchSync(
		serverId: string,
		accounts: SyncedLocalAccount[]
	): Promise<BatchSyncLocalAccountsResponse> {
		return this.request(
			'PUT',
			`/v1/servers/${encodeURIComponent(serverId)}/local-accounts:batchSync`,
			BatchSyncLocalAccountsResponseSchema,
			{ accounts }
		)
	}

	/** Replace group sets for the listed accounts. */
	async assignGroups(
		serverId: string,
		assignments: LocalAccountGroupAssignment[],
		reason?: string
	): Promise<BatchAssignLocalAccountGroupsResponse> {
		return this.request(
			'POST',
			`/v1/servers/${encodeURIComponent(serverId)}/local-accounts:groups`,
			BatchAssignLocalAccountGroupsResponseSchema,
			reason !== undefined ? { assignments, reason } : { assignments }
		)
	}

	/** Enable the listed accounts. */
	async enable(serverId: string, subjectIds: string[]): Promise<BatchEnableLocalAccountsResponse> {
		return this.request(
			'POST',
			`/v1/servers/${encodeURIComponent(serverId)}/local-accounts:enable`,
			BatchEnableLocalAccountsResponseSchema,
			{ subjectIds }
		)
	}

	/** Disable the listed accounts and disconnect their sessions. */
	async disable(
		serverId: string,
		subjectIds: string[]
	): Promise<BatchDisableLocalAccountsResponse> {
		return this.request(
			'POST',
			`/v1/servers/${encodeURIComponent(serverId)}/local-accounts:disable`,
			BatchDisableLocalAccountsResponseSchema,
			{ subjectIds }
		)
	}

	/** Delete the listed accounts (not idempotent — 404 once gone). */
	async delete(serverId: string, subjectIds: string[]): Promise<BatchDeleteLocalAccountsResponse> {
		return this.request(
			'POST',
			`/v1/servers/${encodeURIComponent(serverId)}/local-accounts:delete`,
			BatchDeleteLocalAccountsResponseSchema,
			{ subjectIds }
		)
	}
}
