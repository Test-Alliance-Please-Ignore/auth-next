declare module 'mysql2/promise' {
	export function createPool(config: unknown): {
		query<T = unknown>(sql: string): Promise<[T, unknown]>
		end(): Promise<void>
	}
}
