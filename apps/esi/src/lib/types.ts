export interface EsiResponse<T> {
	data: T
	expiresAt: Date | null
	etag: string | null
	pages: number | null
	page: number | null
	lastModified?: Date // When cache entry was written (for ETag revalidation)
}
