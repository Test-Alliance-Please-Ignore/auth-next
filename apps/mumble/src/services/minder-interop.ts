import { and, eq } from '@repo/db-utils'

import { users } from '../db/schema'
import { hashPassword } from '../hazmat'
import { ServiceContext } from './context'

const HASH_ITERATIONS = 200_000
const MINDER_API_BASE_URL = 'https://minder2.pleaseignore.com/api/v1'

export class MinderInteropService {
	private ctx: ServiceContext

	constructor(ctx: ServiceContext) {
		this.ctx = ctx
	}

	private async getAccessToken() {
		const response = await fetch(this.ctx.env.KEYCLOAK_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: this.ctx.env.KEYCLOAK_GRANT_TYPE,
				client_id: this.ctx.env.KEYCLOAK_CLIENT_ID,
				client_secret: this.ctx.env.KEYCLOAK_CLIENT_SECRET,
			}),
		})

		if (!response.ok) {
			throw new Error(`Failed to get access token: ${response.statusText}`)
		}

		return response.json<{ access_token: string }>()
	}

	private async _doRequest(method: string, path: string, options?: RequestInit): Promise<Response> {
		const accessToken = await this.getAccessToken()
		if (!accessToken.access_token) {
			throw new Error('Failed to get access token')
		}

		const headers = new Headers(options?.headers)
		headers.set('Authorization', `Bearer ${accessToken.access_token}`)

		return fetch(`${MINDER_API_BASE_URL}${path}`, {
			...options,
			method,
			headers,
		})
	}

	async getMumbleUser(userName: string) {
		return this.ctx.db.query.users.findFirst({
			where: eq(users.userName, userName),
		})
	}

	async getMumbleUserByCoreUserId(coreUserId: string) {
		return this.ctx.db.query.users.findFirst({
			where: eq(users.coreUserId, coreUserId),
		})
	}

	async addUser(
		username: string,
		password: string,
		characterName: string,
		corporationTicker: string,
		corporationName: string
	): Promise<{ username: string; password: string }> {
		const { hash, salt, iterations } = await hashPassword(password, HASH_ITERATIONS)

		const response = await this._doRequest('POST', '/users/create', {
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				username,
				password_hash: hash,
				password_salt: salt,
				password_kdf_iterations: iterations,
				character: characterName,
				corporation_ticker: corporationTicker,
				corporation_name: corporationName,
				groups: [],
			}),
		})

		if (!response.ok) {
			throw new Error(`Bad status code from Minder2: ${response.statusText}`)
		}

		return { username, password: '' }
	}

	async checkUser(username: string): Promise<boolean> {
		return false
	}

	async deleteUser(username: string): Promise<boolean> {
		const response = await this._doRequest('DELETE', `/users/user/${username}`)

		if (!response.ok) {
			throw new Error(`Bad status code from Minder2: ${response.statusText}`)
		}

		return true
	}

	async disableUser(username: string): Promise<boolean> {
		const response = await this._doRequest('POST', `/users/disable/${username}`)

		if (!response.ok) {
			throw new Error(`Bad status code from Minder2: ${response.statusText}`)
		}

		return true
	}

	async enableUser(username: string, password: string): Promise<boolean> {
		const response = await this._doRequest('POST', `/users/enable/${username}`)

		if (!response.ok) {
			throw new Error(`Bad status code from Minder2: ${response.statusText}`)
		}

		return true
	}

	async resetPassword(username: string, password: string): Promise<boolean> {
		const { hash, salt, iterations } = await hashPassword(password, HASH_ITERATIONS)

		const response = await this._doRequest('POST', `/users/password/${username}`, {
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				password_hash: hash,
				password_salt: salt,
				password_kdf_iterations: iterations,
			}),
		})

		if (!response.ok) {
			throw new Error(`Bad status code from Minder2: ${response.statusText}`)
		}

		return true
	}

	async updateGroups(
		username: string,
		characterName: string,
		corporationTicker: string,
		corporationName: string,
		groups: string[] = []
	): Promise<void> {
		const response = await this._doRequest('POST', `/users/user/${username}`, {
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				username,
				character: characterName,
				corporation_ticker: corporationTicker,
				corporation_name: corporationName,
				groups,
			}),
		})

		if (!response.ok) {
			throw new Error(`Bad status code from Minder2: ${response.statusText}`)
		}
	}
}
