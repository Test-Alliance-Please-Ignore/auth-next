declare module 'mysql2/promise' {
	export interface RowDataPacket {
		[key: string]: unknown
	}

	export interface QueryablePool {
		query<T = unknown>(sql: string, values?: unknown[]): Promise<[T, unknown]>
		end(): Promise<void>
	}

	export function createPool(config: unknown): QueryablePool
}
