import { createApiClient, EndpointType } from '@neondatabase/api-client'

import type { ConnectionDetails } from '@neondatabase/api-client'
import type { NeonTestEnv } from './types'

/**
 * Creates a PostgreSQL connection URI from connection parameters
 *
 * @param connectionParameters - The connection parameters object
 * @param type - The type of connection to create (pooler or direct)
 * @returns A PostgreSQL connection URI string
 */
function createConnectionUri(connectionParameters: ConnectionDetails, type: 'pooler' | 'direct') {
	const { role, password, host, pooler_host, database } = connectionParameters.connection_parameters

	const hostname = type === 'pooler' ? pooler_host : host

	return `postgresql://${role}:${password}@${hostname}/${database}?sslmode=require`
}

export class TestBranchManager<Env extends NeonTestEnv> {
	private apiClient: ReturnType<typeof createApiClient>
	private branchId: string | undefined = undefined

	public connectionUrl: string | undefined = undefined

	constructor(private readonly env: Env) {
		this.apiClient = createApiClient({ apiKey: this.env.NEON_API_KEY })
	}

	async deleteBranch() {
		if (!this.branchId) {
			throw new Error('No branch to delete')
		}

		await this.apiClient.deleteProjectBranch(this.env.NEON_PROJECT_ID, this.branchId)
		this.branchId = undefined
	}

	async createBranch(options: {
		branchName: string
		parentBranchId: string
		schemaOnly: boolean
		endpoint: 'pooler' | 'direct'
	}) {
		const { data } = await this.apiClient.createProjectBranch(this.env.NEON_PROJECT_ID, {
			branch: {
				name: options.branchName,
				parent_id: options.parentBranchId,
				init_source: options.schemaOnly ? 'schema-only' : undefined,
			},
			endpoints: [{ type: EndpointType.ReadWrite }],
			annotation_value: {
				'integration-test': 'true',
			},
		})

		this.branchId = data.branch.id

		const [connectionUri] = data.connection_uris ?? []

		if (!connectionUri) {
			throw new Error('No connection URI found')
		}

		const connectionUrl = createConnectionUri(connectionUri, options.endpoint ?? 'pooler')
		this.connectionUrl = connectionUrl
		return connectionUrl
	}

	async beforeAll(): Promise<string> {
		const branchName = `test-${crypto.randomUUID()}`
		const response = await this.createBranch({
			branchName,
			parentBranchId: 'br-aged-credit-adf5wd07',
			schemaOnly: true,
			endpoint: 'pooler',
		})
		return response
	}

	async afterAll() {
		await this.deleteBranch()
		delete process.env.DATABASE_URL
	}
}
