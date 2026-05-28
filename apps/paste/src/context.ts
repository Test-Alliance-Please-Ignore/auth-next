export type Env = {
	DATABASE_URL: string
	PASTE_BUCKET: R2Bucket
	PASTE_THROTTLE: KVNamespace
	NAME: string
	ENVIRONMENT: string
	SENTRY_RELEASE: string
}
